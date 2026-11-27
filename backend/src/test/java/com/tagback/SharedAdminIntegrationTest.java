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
@SpringBootTest(properties={"spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55461/tagback_admin_test",
        "spring.datasource.username=postgres","spring.datasource.password=",
        "tagback.auth.sms-hash-key=isolated-admin-test-key-at-least-32-bytes",
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
        jdbc.execute("truncate table users,item_types,administrators,admin_sessions,admin_login_limits,admin_tag_operations,nfc_scan_proof_uses restart identity cascade");
        typeId=jdbc.queryForObject("insert into item_types(name) values ('시험 우산') returning item_type_id",Long.class);
    }
    Map<String,Object> body(String value) { return json.readValue(value,Map.class); }
    Cookie web() throws Exception {
        var response=mvc.perform(post("/api/v1/admin/auth/login").contentType("application/json")
                .content(json.writeValueAsString(Map.of("adminNumber","000","password",PASSWORD))))
                .andExpect(status().isOk()).andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("HttpOnly")))
                .andExpect(header().string("Set-Cookie",org.hamcrest.Matchers.containsString("Secure")))
                .andExpect(jsonPath("$.token").doesNotExist()).andReturn().getResponse();
        String cookie=response.getHeader("Set-Cookie");
        return new Cookie(AdminCredentials.COOKIE,cookie.substring(cookie.indexOf('=')+1,cookie.indexOf(';')));
    }
    String kiosk() throws Exception {
        return (String)body(mvc.perform(post("/api/v1/kiosk/admin/login").contentType("application/json")
                .content(json.writeValueAsString(Map.of("adminNumber","000","password",PASSWORD))))
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
    @Test void individualAccountsRequirePasswordChangeAndRepresentativeAuthority() throws Exception {
        Cookie owner=web();
        var added=body(mvc.perform(post("/api/v1/admin/accounts").cookie(owner).contentType("application/json")
            .content("{\"adminNumber\":\"001\",\"name\":\"Operator One\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String temporary=(String)added.get("temporaryPassword");
        var login=body(mvc.perform(post("/api/v1/kiosk/admin/login").contentType("application/json")
            .content(json.writeValueAsString(Map.of("adminNumber","001","password",temporary))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.mustChangePassword").value(true)).andReturn().getResponse().getContentAsString());
        String token=(String)login.get("token");
        mvc.perform(get("/api/v1/admin/users").header("Authorization","Bearer "+token)).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/admin/auth/password").header("Authorization","Bearer "+token).contentType("application/json")
            .content(json.writeValueAsString(Map.of("currentPassword",temporary,"newPassword","Personal-test-2026!")))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/users").header("Authorization","Bearer "+token)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/item-types").header("Authorization","Bearer "+token).header("X-TagBack-Admin","1")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/accounts").header("Authorization","Bearer "+token)).andExpect(status().isForbidden());
        mvc.perform(patch("/api/v1/admin/accounts/001").cookie(owner).contentType("application/json")
            .content("{\"name\":\"Operator One\",\"active\":false}")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/users").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/access-log").cookie(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].adminNumber").value("001"));
    }
    @Test void publicIndividualCatalogueHidesPendingAndImagesFallBackByType() throws Exception {
        Cookie owner=web();long pending=item(owner);long visible=item(owner);String token=kiosk();
        connect(token,command(visible,null,proof("AABBCCDD",0))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/catalog/items")).andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1)).andExpect(jsonPath("$.items[0].itemId").value(Long.toString(visible)));
        var image=new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB);
        var out=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(image,"png",out);
        String payload=json.writeValueAsString(Map.of("data",Base64.getEncoder().encodeToString(out.toByteArray())));
        mvc.perform(put("/api/v1/items/"+pending+"/image").contentType("application/json").content(payload)).andExpect(status().isUnauthorized());
        String url=(String)body(mvc.perform(put("/api/v1/item-types/"+typeId+"/image").cookie(owner).contentType("application/json").content(payload))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("imageUrl");
        mvc.perform(get("/api/v1/catalog/items")).andExpect(jsonPath("$.items[0].typeImageUrl").value(url)).andExpect(jsonPath("$.items[0].imageUrl").isEmpty());
        mvc.perform(get(url)).andExpect(status().isOk()).andExpect(content().contentType("image/png"));
        mvc.perform(put("/api/v1/items/"+visible+"/image").cookie(owner).contentType("application/json").content(payload)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/catalog/items")).andExpect(jsonPath("$.items[0].imageUrl").isString());
        mvc.perform(put("/api/v1/items/"+visible+"/image").cookie(owner).contentType("application/json").content("{\"data\":\"PHN2Zy8+\"}")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/catalog/items").param("keyword","%_")).andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test void independentSessionAndChannelIsolationAndLogout() throws Exception {
        Cookie cookie=web();String token=kiosk();
        mvc.perform(get("/api/v1/admin/auth/session").cookie(cookie)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/auth/session").cookie(cookie)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/kiosk/admin/items").cookie(cookie)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/users").header("Authorization","Bearer "+token)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/kiosk/admin/items").header("Authorization","Bearer "+token)).andExpect(status().isOk());
        mvc.perform(post("/api/v1/admin/auth/logout").cookie(cookie)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/admin/auth/session").cookie(cookie)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/kiosk/admin/logout").header("Authorization","Bearer "+token)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/kiosk/admin/session").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
    }
    @Test void wrongPasswordsAreRateLimitedAndOriginsRejected() throws Exception {
        for(int i=0;i<10;i++) mvc.perform(post("/api/v1/admin/auth/login").contentType("application/json")
                .content("{\"adminNumber\":\"000\",\"password\":\"incorrect\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/admin/auth/login").contentType("application/json")
                .content(json.writeValueAsString(Map.of("adminNumber","000","password",PASSWORD)))).andExpect(status().isTooManyRequests());
        mvc.perform(post("/api/v1/admin/auth/login").header("Origin","https://untrusted.invalid")
                .contentType("application/json").content(json.writeValueAsString(Map.of("adminNumber","000","password",PASSWORD))))
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
