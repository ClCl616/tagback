package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.service.sms.SmsSecrets;
import jakarta.persistence.EntityManager;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Opt-in, isolated PostgreSQL only; every test rolls its fixture and changes back. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@AutoConfigureMockMvc
@Transactional
class ItemCrudPostgresIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager em;
    @Autowired UserRepository users;
    @Autowired BrowserRegistrationRepository browsers;
    @Autowired LoginSessionRepository sessions;
    @Autowired ItemTypeRepository types;
    @Autowired SmsSecrets secrets;
    private Cookie admin;
    private Cookie member;
    private long adminId;
    private long typeId;
    private long otherTypeId;

    @BeforeEach void fixtures() {
        admin = session("+821011111111", UserRole.ADMIN);
        member = session("+821022222222", UserRole.USER);
        typeId = types.saveAndFlush(new ItemType("우산", null)).getId();
        otherTypeId = types.saveAndFlush(new ItemType("계산기", null)).getId();
    }

    private Cookie session(String phone, UserRole role) {
        var now = Instant.now();
        var user = new User(phone, "integration-fixture-only", now);
        ReflectionTestUtils.setField(user, "role", role);
        users.saveAndFlush(user);
        if (role == UserRole.ADMIN) adminId = user.getId();
        var registration = browsers.saveAndFlush(new BrowserRegistration(user,
                secrets.tokenHash(UUID.randomUUID().toString()), now.plusSeconds(7200), now));
        String token = UUID.randomUUID().toString();
        sessions.saveAndFlush(new LoginSession(registration, secrets.tokenHash(token),
                now.plusSeconds(1800), now.plusSeconds(3600), now));
        return new Cookie(AuthCookies.SESSION_COOKIE, token);
    }

    private String create(String name, long kind) throws Exception {
        var response = mvc.perform(post("/api/v1/items").cookie(admin).contentType("application/json")
                .content("{\"itemName\":\"" + name + "\",\"itemTypeId\":\"" + kind + "\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.createdAt").isString())
                .andExpect(jsonPath("$.status").value("TAG_PENDING")).andReturn().getResponse();
        String id = json.readTree(response.getContentAsString()).get("itemId").asString();
        assertEquals("/api/v1/items/" + id, response.getHeader("Location"));
        return id;
    }

    @Test void registrationLookupUpdateDeletionAndLookupAgain() throws Exception {
        String id = create("우산 01", typeId);
        assertEquals("우산 01", jdbc.queryForObject("select item_name from items where item_id = ?", String.class, Long.valueOf(id)));
        mvc.perform(get("/api/v1/items/" + id).cookie(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.itemTypeName").value("우산"));
        mvc.perform(patch("/api/v1/items/" + id).cookie(admin).contentType("application/json")
                .content("{\"itemName\":\" 우산 02 \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.itemName").value("우산 02"));
        em.clear();
        mvc.perform(get("/api/v1/items/" + id).cookie(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.itemName").value("우산 02"));
        mvc.perform(patch("/api/v1/items/" + id).cookie(admin).contentType("application/json")
                .content("{\"itemTypeId\":\"" + otherTypeId + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.itemName").value("우산 02"))
                .andExpect(jsonPath("$.itemTypeName").value("계산기"));
        assertEquals(otherTypeId, jdbc.queryForObject("select item_type_id from items where item_id = ?", Long.class, Long.valueOf(id)));
        mvc.perform(delete("/api/v1/items/" + id).cookie(admin)).andExpect(status().isNoContent());
        assertEquals(0, jdbc.queryForObject("select count(*) from items where item_id = ?", Integer.class, Long.valueOf(id)));
        mvc.perform(get("/api/v1/items/" + id).cookie(member)).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ITEM_NOT_FOUND"));
        mvc.perform(delete("/api/v1/items/" + id).cookie(admin)).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ITEM_NOT_FOUND"));
    }

    @Test void databaseRejectsAvailableStatusWithoutTag() throws Exception {
        String id = create("태그 없는 물품", typeId);

        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "update items set status = 'AVAILABLE' where item_id = ?", Long.valueOf(id)));
    }

    @Test void databaseRejectsRemovingTagFromAvailableItem() throws Exception {
        String id = create("태그 삭제 방지 물품", typeId);
        jdbc.update("insert into nfc_tags(item_id, tag_uid) values (?, ?)", Long.valueOf(id), "integration-protected-tag");
        jdbc.update("update items set status = 'AVAILABLE' where item_id = ?", Long.valueOf(id));

        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "delete from nfc_tags where item_id = ?", Long.valueOf(id)));
    }

    @Test void realQueriesHandleFiltersSortingPagingAndEmptyResults() throws Exception {
        String first = create("우산 01", typeId);
        String second = create("우산 02", typeId);
        String rented = create("계산기 01", otherTypeId);
        jdbc.update("update items set status = 'RENTED' where item_id = ?", Long.valueOf(rented));
        em.clear();
        mvc.perform(get("/api/v1/items").cookie(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3));
        mvc.perform(get("/api/v1/items").cookie(member).param("itemTypeId", Long.toString(typeId))
                .param("status", "TAG_PENDING").param("size", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.items[0].itemId").value(second));
        mvc.perform(get("/api/v1/items").cookie(member).param("itemTypeId", Long.toString(typeId))
                .param("page", "1").param("size", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].itemId").value(first));
        mvc.perform(get("/api/v1/items").cookie(member).param("status", "REPAIR"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/v1/items").cookie(member).param("status", "RENTED"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].itemId").value(rented));
    }

    @Test void realTagRentalAndInspectionReferencesPreventDeletionAndHistoryPreventsTypeChange() throws Exception {
        String tagItem = create("태그 물품", typeId);
        String rentalItem = create("대여 물품", typeId);
        String inspectionItem = create("점검 물품", typeId);
        jdbc.update("insert into nfc_tags(item_id, tag_uid) values (?, ?)", Long.valueOf(tagItem), "integration-tag");
        jdbc.update("insert into rentals(user_id, item_id, due_at, returned_at, status) "
                + "values (?, ?, current_timestamp + interval '1 day', current_timestamp, 'RETURNED')", adminId, Long.valueOf(rentalItem));
        jdbc.update("insert into inspections(item_id, inspection_type, status) values (?, 'MANUAL', 'NORMAL')", Long.valueOf(inspectionItem));
        for (String id : new String[]{tagItem, rentalItem, inspectionItem}) {
            mvc.perform(delete("/api/v1/items/" + id).cookie(admin)).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("ITEM_DELETE_CONFLICT"));
            assertEquals(1, jdbc.queryForObject("select count(*) from items where item_id = ?", Integer.class, Long.valueOf(id)));
        }
        for (String id : new String[]{rentalItem, inspectionItem}) {
            mvc.perform(patch("/api/v1/items/" + id).cookie(admin).contentType("application/json")
                    .content("{\"itemTypeId\":\"" + otherTypeId + "\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("ITEM_TYPE_CHANGE_CONFLICT"));
        }
    }

    @Test void databaseSessionRoleIsEnforcedForWrites() throws Exception {
        String id = create("권한 검증 물품", typeId);
        mvc.perform(delete("/api/v1/items/" + id).cookie(member)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/items/" + id)).andExpect(status().isUnauthorized());
        jdbc.update("update users set role = 'USER' where user_id = ?", adminId);
        em.clear();
        mvc.perform(delete("/api/v1/items/" + id).cookie(admin)).andExpect(status().isForbidden());
        assertEquals(1, jdbc.queryForObject("select count(*) from items where item_id = ?", Integer.class, Long.valueOf(id)));
    }
}
