package com.tagback;

import com.tagback.config.*;
import com.tagback.service.AdminPassword;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@EnabledIfEnvironmentVariable(named="TAGBACK_ADMIN_TEST",matches="true")
@SpringBootTest(properties={"spring.profiles.active=kakao-auth",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55461/tagback_admin_test",
        "spring.datasource.username=postgres","spring.datasource.password=",
        "tagback.auth.common-hash-key=isolated-admin-common-key-at-least-32-bytes",
        "tagback.kakao.hmac-key=isolated-admin-hmac-key-at-least-32-bytes",
        "tagback.kakao.skill-secret=isolated-admin-secret-key-at-least-32-bytes",
        "tagback.kakao.bot-id=test-bot",
        "tagback.nfc.scan-secret=isolated-nfc-test-key-at-least-32-bytes","tagback.nfc.bridge-id=test-reader"})
@AutoConfigureMockMvc
class SharedAdminIntegrationTest {
    static final String PASSWORD="Admin-test-only-2026!";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        String hash=AdminPassword.hash(PASSWORD);registry.add("tagback.admin.password-hash",()->hash);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    long typeId;
    @BeforeEach void resetIsolatedDatabase() {
        String database=jdbc.queryForObject("select current_database()",String.class);
        assertEquals("tagback_admin_test",database);
        jdbc.execute("truncate table users,item_types,admin_sessions,admin_login_limits,admin_tag_operations,nfc_scan_proof_uses restart identity cascade");
        typeId=jdbc.queryForObject("insert into item_types(name) values ('시험 우산') returning item_type_id",Long.class);
    }
    Map<String,Object> body(String value) { return json.readValue(value,Map.class); }
    Cookie web() throws Exception {
        var response=mvc.perform(post("/api/v1/admin/auth/login").contentType("application/json")
                .content(json.writeValueAsString(Map.of("password",PASSWORD))))
                .andExpect(status().isOk()).andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("HttpOnly")))
                .andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("Secure")))
                .andExpect(jsonPath("$.token").doesNotExist()).andReturn().getResponse();
        String cookie=response.getHeader("Set-Cookie");
        return new Cookie(AdminCredentials.COOKIE,cookie.substring(cookie.indexOf('=')+1,cookie.indexOf(';')));
    }
    String kiosk() throws Exception {
        return (String)body(mvc.perform(post("/api/v1/kiosk/admin/login").contentType("application/json")
                .content(json.writeValueAsString(Map.of("password",PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("token");
    }
    long item(Cookie cookie) throws Exception {
        var response=mvc.perform(post("/api/v1/items").cookie(cookie).contentType("application/json")
                .content(json.writeValueAsString(Map.of("itemName","우산","itemTypeId",Long.toString(typeId)))))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("TAG_PENDING"))
                .andReturn().getResponse();
        return Long.parseLong((String)body(response.getContentAsString()).get("itemId"));
    }
    Map<String,Object> proof(String uid,long age) throws Exception {
        long issued=Instant.now().toEpochMilli()-age;String nonce=UUID.randomUUID().toString();
        Mac mac=Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("isolated-nfc-test-key-at-least-32-bytes".getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
        String signature=HexFormat.of().formatHex(mac.doFinal(("test-reader\n"+uid+"\n"+issued+"\n"+nonce).getBytes(StandardCharsets.UTF_8)));
        return new HashMap<>(Map.of("bridgeId","test-reader","uid",uid,"issuedAt",issued,"nonce",nonce,"signature",signature));
    }
    Map<String,Object> command(long item,String expected,Map<String,Object> proof) {
        var data=new HashMap<String,Object>();data.put("operationId",UUID.randomUUID().toString());data.put("itemId",item);
        data.put("expectedUid",expected);data.put("proof",proof);return data;
    }
    org.springframework.test.web.servlet.ResultActions connect(String token,Map<String,Object> data) throws Exception {
        return mvc.perform(post("/api/v1/kiosk/admin/tags").header("Authorization","Bearer "+token)
                .contentType("application/json").content(json.writeValueAsString(data)));
    }
    @Test void independentSessionAndChannelIsolationAndLogout() throws Exception {
        Cookie cookie=web();String token=kiosk();
        mvc.perform(get("/api/v1/admin/auth/session").cookie(cookie)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/auth/session").cookie(cookie)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/kiosk/admin/items").cookie(cookie)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/users").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/kiosk/admin/items").header("Authorization","Bearer "+token)).andExpect(status().isOk());
        mvc.perform(post("/api/v1/admin/auth/logout").cookie(cookie)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/admin/auth/session").cookie(cookie)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/kiosk/admin/logout").header("Authorization","Bearer "+token)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/kiosk/admin/session").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
    }
    @Test void wrongPasswordsAreRateLimitedAndOriginsRejected() throws Exception {
        for(int i=0;i<10;i++) mvc.perform(post("/api/v1/admin/auth/login").contentType("application/json")
                .content("{\"password\":\"incorrect\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/admin/auth/login").contentType("application/json")
                .content(json.writeValueAsString(Map.of("password",PASSWORD)))).andExpect(status().isTooManyRequests());
        mvc.perform(post("/api/v1/admin/auth/login").header("Origin","https://untrusted.invalid")
                .contentType("application/json").content(json.writeValueAsString(Map.of("password",PASSWORD))))
                .andExpect(status().isForbidden());
        assertEquals(0,jdbc.queryForObject("select count(*) from admin_sessions",Integer.class));
    }
    @Test void itemCreationAndEditingDoNotAttachTagAndLegacyUidWritesAreDenied() throws Exception {
        Cookie cookie=web();long id=item(cookie);
        mvc.perform(patch("/api/v1/items/"+id).cookie(cookie).contentType("application/json").content("{\"itemName\":\"수정 우산\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("TAG_PENDING"));
        mvc.perform(post("/api/items/"+id+"/tag").cookie(cookie).contentType("application/json").content("{\"uid\":\"AABBCCDD\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(patch("/api/v1/items/"+id+"/status").cookie(cookie).contentType("application/json").content("{\"status\":\"AVAILABLE\"}"))
                .andExpect(status().isConflict());
        assertEquals(0,jdbc.queryForObject("select count(*) from nfc_tags",Integer.class));
        assertEquals(2,jdbc.queryForObject("select count(*) from admin_audit",Integer.class));
    }
    @Test void signedRegistrationAndReplayAreAtomicAndAuditSharedSession() throws Exception {
        long id=item(web());String token=kiosk();var data=command(id,null,proof("AABBCCDD",0));
        connect(token,data).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("AVAILABLE"));
        connect(token,data).andExpect(status().isOk()).andExpect(jsonPath("$.uid").value("AABBCCDD"));
        // A fresh admin session can reconcile the same operation after its previous session expired.
        connect(kiosk(),data).andExpect(status().isOk());
        assertEquals(1,jdbc.queryForObject("select count(*) from nfc_tags",Integer.class));
        assertEquals(1,jdbc.queryForObject("select count(*) from admin_audit where action='TAG_REGISTER'",Integer.class));
        data.put("itemId",id+1);connect(token,data).andExpect(status().isConflict());
    }
    @Test void replacementPreservesInspectionAndRejectsRentedOrConcurrentChanges() throws Exception {
        Cookie cookie=web();long id=item(cookie);String token=kiosk();
        connect(token,command(id,null,proof("AABBCCDD",0))).andExpect(status().isOk());
        mvc.perform(patch("/api/v1/items/"+id+"/status").cookie(cookie).contentType("application/json")
                .content("{\"status\":\"INSPECTION\",\"reason\":\"점검\"}")).andExpect(status().isOk());
        connect(token,command(id,"AABBCCDD",proof("11223344",0))).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INSPECTION"));
        connect(token,command(id,"AABBCCDD",proof("55667788",0))).andExpect(status().isConflict());
        jdbc.update("update items set status='RENTED' where item_id=?",id);
        connect(token,command(id,"11223344",proof("11223344",0))).andExpect(status().isConflict());
        connect(token,command(id,"11223344",proof("55667788",0))).andExpect(status().isConflict());
        assertEquals(1,jdbc.queryForObject("select count(*) from item_status_history where source='ADMIN_API' and admin_session_id is not null and changed_by_user_id is null",Integer.class));
    }
    @Test void forgedDuplicateAndReusedProofsCannotAttachAnotherItem() throws Exception {
        Cookie cookie=web();long a=item(cookie),b=item(cookie);String token=kiosk();
        var scan=proof("AABBCCDD",0);var forged=new HashMap<>(scan);forged.put("signature","0".repeat(64));
        connect(token,command(a,null,forged)).andExpect(status().is4xxClientError());
        connect(token,command(a,null,scan)).andExpect(status().isOk());
        connect(token,command(b,null,scan)).andExpect(status().is4xxClientError());
        connect(token,command(b,null,proof("AABBCCDD",0))).andExpect(status().isConflict());
        assertEquals("TAG_PENDING",jdbc.queryForObject("select status from items where item_id=?",String.class,b));
    }
    @Test void expiredUnknownOperationCanBeSafelyResolvedAsNotApplied() throws Exception {
        long id=item(web());String token=kiosk();var data=command(id,null,proof("AABBCCDD",61000));
        connect(token,data).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("NOT_APPLIED"));
        connect(token,data).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("NOT_APPLIED"));
        assertEquals(0,jdbc.queryForObject("select count(*) from nfc_tags",Integer.class));
    }
    @Test void expiredAndOldPasswordVersionSessionsCannotAccessAdmin() throws Exception {
        Cookie cookie=web();jdbc.update("update admin_sessions set expires_at=current_timestamp-interval '1 second'");
        mvc.perform(get("/api/v1/admin/users").cookie(cookie)).andExpect(status().isUnauthorized());
        cookie=web();jdbc.update("update admin_sessions set password_version='old'");
        mvc.perform(get("/api/v1/admin/users").cookie(cookie)).andExpect(status().isUnauthorized());
    }
}
