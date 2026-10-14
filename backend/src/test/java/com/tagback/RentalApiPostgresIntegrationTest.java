package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.service.sms.SmsSecrets;
import jakarta.servlet.http.Cookie;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** HTTP boundary + actual Flyway/PostgreSQL transactions. No test-wide transaction or mocked authentication. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@AutoConfigureMockMvc
@Import(RentalApiPostgresIntegrationTest.TimeConfig.class)
class RentalApiPostgresIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-10-14T03:00:00.123456Z");
    static class TestClock extends Clock {
        private final AtomicReference<Instant> time = new AtomicReference<>(NOW);
        void set(Instant now) { time.set(now); }
        @Override public Instant instant() { return time.get(); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(instant(), zone); }
    }
    @TestConfiguration static class TimeConfig {
        @Bean @Primary TestClock rentalApiClock() { return new TestClock(); }
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactions;
    @Autowired TestClock clock;
    @Autowired UserRepository users;
    @Autowired BrowserRegistrationRepository browsers;
    @Autowired LoginSessionRepository sessions;
    @Autowired ItemTypeRepository types;
    @Autowired ItemRepository items;
    @Autowired NfcTagRepository tags;
    @Autowired SmsSecrets secrets;
    private long userId;
    private long otherUserId;
    private long itemId;
    private long otherItemId;
    private long typeId;
    private Cookie member;
    private Cookie otherMember;

    @BeforeEach void fixtures() {
        clock.set(NOW);
        jdbc.update("delete from rental_verification_limits");
        transactions.executeWithoutResult(tx -> {
            var user = users.saveAndFlush(new User("+821033333333", "test-only", NOW));
            var other = users.saveAndFlush(new User("+821044444444", "test-only", NOW));
            userId = user.getId(); otherUserId = other.getId();
            member = session(user); otherMember = session(other);
            var type = types.saveAndFlush(new ItemType("반출 API " + UUID.randomUUID(), null));
            typeId = type.getId();
            itemId = item(type, "04A23B1C5D6E80");
            otherItemId = item(type, "04A23B1C5D6E81");
        });
    }

    @AfterEach void cleanup() {
        transactions.executeWithoutResult(tx -> {
            jdbc.update("delete from rental_operations where item_id in (?, ?)", itemId, otherItemId);
            jdbc.update("delete from rental_grants where rental_code_id in (select rental_code_id from rental_codes where user_id in (?, ?))", userId, otherUserId);
            jdbc.update("delete from rental_codes where user_id in (?, ?)", userId, otherUserId);
            jdbc.update("delete from item_status_history where item_id in (?, ?)", itemId, otherItemId);
            jdbc.update("delete from rentals where item_id in (?, ?)", itemId, otherItemId);
            jdbc.update("update items set status = 'TAG_PENDING' where item_id in (?, ?)", itemId, otherItemId);
            jdbc.update("delete from nfc_tags where item_id in (?, ?)", itemId, otherItemId);
            jdbc.update("delete from items where item_id in (?, ?)", itemId, otherItemId);
            jdbc.update("delete from item_types where item_type_id = ?", typeId);
            jdbc.update("delete from login_sessions where user_id in (?, ?)", userId, otherUserId);
            jdbc.update("delete from browser_registrations where user_id in (?, ?)", userId, otherUserId);
            jdbc.update("delete from users where user_id in (?, ?)", userId, otherUserId);
            jdbc.update("delete from rental_verification_limits");
        });
    }

    @Test void storesRentalAndReturnsAllFieldsThenReplaysOriginalSnapshot() throws Exception {
        String code = issue(member);
        assertEquals(code, issue(member));
        String token = verify(code);
        assertEquals(0, count("rentals"));
        String key = key();
        var created = perform(token, key, body(itemId)).andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.rentalId").isString())
                .andExpect(jsonPath("$.itemId").value(Long.toString(itemId)))
                .andExpect(jsonPath("$.itemTypeId").value(Long.toString(typeId)))
                .andExpect(jsonPath("$.rentalStatus").value("RENTED"))
                .andExpect(jsonPath("$.itemStatus").value("RENTED"))
                .andExpect(jsonPath("$.rentedAt").value(NOW.toString()))
                .andExpect(jsonPath("$.dueAt").value(NOW.plusSeconds(72 * 3600).toString()))
                .andExpect(jsonPath("$.returnedAt").value(org.hamcrest.Matchers.nullValue()))
                .andReturn().getResponse().getContentAsString();
        assertEquals(userId, jdbc.queryForObject("select user_id from rentals where item_id = ?", Long.class, itemId));
        assertEquals(1, count("item_status_history"));
        assertEquals(1, count("rental_operations"));
        assertEquals(1, jdbc.queryForObject("select count(*) from rental_codes where user_id = ? and consumed_at is not null", Integer.class, userId));
        jdbc.update("update rentals set due_at = due_at + interval '1 day' where item_id = ?", itemId);
        var replay = perform(token, key, body(itemId)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(json.readTree(created), json.readTree(replay));
        assertEquals(1, count("rentals"));
        assertEquals(1, count("item_status_history"));
    }

    @Test void rejectsMalformedBodiesAndClientSuppliedIdentityWithoutConsumingCode() throws Exception {
        String token = verify(issue(member));
        for (String invalid : new String[]{"{}", "null", "{", "{\"itemId\":12,\"itemTypeId\":\"1\"}",
                "{\"itemId\":true,\"itemTypeId\":\"1\"}", "{\"itemId\":null,\"itemTypeId\":\"1\"}",
                "{\"itemId\":\"01\",\"itemTypeId\":\"1\"}", "{\"itemId\":\"9223372036854775808\",\"itemTypeId\":\"1\"}",
                body(itemId).replace("}", ",\"userId\":\"999\"}"), body(itemId).replace("}", ",\"dueAt\":\"2099-01-01T00:00:00Z\"}")}) {
            perform(token, key(), invalid).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        assertEquals(0, count("rentals"));
        perform(token, key(), body(itemId)).andExpect(status().isCreated());
    }

    @Test void requiresRentalGrantAndRejectsAmbiguousCredentialsAndKeys() throws Exception {
        mvc.perform(post("/api/v1/rentals").cookie(member).contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_REQUIRED"));
        perform("x".repeat(43), key(), body(itemId)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_INVALID"));
        String token = verify(issue(member));
        mvc.perform(request(token, key(), body(itemId)).header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
        mvc.perform(request(token, key(), body(itemId)).header("Idempotency-Key", key()))
                .andExpect(status().isBadRequest());
        perform(token, "1-1-1-1-1", body(itemId)).andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/rentals").header("Authorization", "Bearer " + token).contentType("application/json").content(body(itemId)))
                .andExpect(status().isBadRequest());
        assertEquals(0, count("rentals"));
    }

    @Test void appliesSessionAndOriginChecksToCodeIssuanceAndKioskWrites() throws Exception {
        mvc.perform(post("/api/v1/rental-codes").contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        mvc.perform(post("/api/v1/rental-codes").cookie(member).header("Origin", "https://untrusted.example")
                .contentType("application/json").content("{}")) .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/rental-codes").cookie(member).contentType("application/json").content("{\"userId\":\"999\"}"))
                .andExpect(status().isBadRequest());
        String code = issue(member);
        mvc.perform(post("/api/v1/kiosk/rental-grants").header("Origin", "https://untrusted.example")
                .contentType("application/json").content("{\"code\":\"" + code + "\"}")) .andExpect(status().isForbidden());
        String token = verify(code);
        mvc.perform(request(token, key(), body(itemId)).header("Origin", "https://untrusted.example"))
                .andExpect(status().isForbidden());
        assertEquals(0, count("rentals"));
    }

    @Test void distinguishesMissingItemTypeMismatchUnavailableAndActiveRental() throws Exception {
        String token = verify(issue(member));
        perform(token, key(), body(Long.MAX_VALUE)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("ITEM_NOT_FOUND"));
        perform(token, key(), "{\"itemId\":\"" + itemId + "\",\"itemTypeId\":\"9223372036854775807\"}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("ITEM_TYPE_MISMATCH"));
        jdbc.update("update items set status = 'INSPECTION' where item_id = ?", itemId);
        perform(token, key(), body(itemId)).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("ITEM_NOT_AVAILABLE"));
        jdbc.update("update items set status = 'AVAILABLE' where item_id = ?", itemId);
        perform(token, key(), body(itemId)).andExpect(status().isCreated());
        String otherToken = verify(issue(otherMember));
        perform(otherToken, key(), body(itemId)).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("RENTAL_ALREADY_ACTIVE"));
        perform(otherToken, key(), body(otherItemId)).andExpect(status().isCreated());
    }

    @Test void conflictsOnChangedBodyOrConsumedCodeButKeepsSameRequestReplay() throws Exception {
        String code = issue(member);
        String token = verify(code);
        String secondToken = verify(code);
        String key = key();
        perform(token, key, body(itemId)).andExpect(status().isCreated());
        perform(token, key, body(otherItemId)).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("IDEMPOTENCY_KEY_CONFLICT"));
        perform(token, key(), body(otherItemId)).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("RENTAL_CODE_CONSUMED"));
        perform(secondToken, key, body(otherItemId)).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("RENTAL_CODE_CONSUMED"));
        perform(token, key, body(itemId)).andExpect(status().isOk());
        assertEquals(1, count("rentals"));
    }

    @Test void concurrentSameOperationCreatesOneRentalAndReturnsOneReplay() throws Exception {
        String token = verify(issue(member));
        String key = key();
        var responses = race(() -> perform(token, key, body(itemId)).andReturn(), () -> perform(token, key, body(itemId)).andReturn());
        assertEquals(Set.of(200, 201), new HashSet<>(responses.stream().map(r -> r.getResponse().getStatus()).toList()));
        assertEquals(json.readTree(responses.getFirst().getResponse().getContentAsString()), json.readTree(responses.getLast().getResponse().getContentAsString()));
        assertEquals(1, count("rentals"));
        assertEquals(1, count("rental_operations"));
        assertEquals(1, count("item_status_history"));
    }

    @Test void twoGrantsForOneCodeCannotBorrowTwoItemsConcurrently() throws Exception {
        String code = issue(member);
        String one = verify(code);
        String two = verify(code);
        var responses = race(() -> perform(one, key(), body(itemId)).andReturn(), () -> perform(two, key(), body(otherItemId)).andReturn());
        assertRaceConflict(responses, "RENTAL_CODE_CONSUMED");
        assertEquals(1, count("rentals"));
        assertEquals(1, count("rental_operations"));
    }

    @Test void twoUsersCannotBorrowOneItemConcurrentlyAndLoserCodeRemainsUnused() throws Exception {
        String one = verify(issue(member));
        String two = verify(issue(otherMember));
        var responses = race(() -> perform(one, key(), body(itemId)).andReturn(), () -> perform(two, key(), body(itemId)).andReturn());
        assertRaceConflict(responses, "RENTAL_ALREADY_ACTIVE");
        assertEquals(1, count("rentals"));
        assertEquals(1, jdbc.queryForObject("select count(*) from rental_codes where user_id in (?, ?) and consumed_at is not null", Integer.class, userId, otherUserId));
    }

    @Test void replayStorageFailureRollsBackCodeRentalItemAndHistoryThenSameRequestCanRetry() throws Exception {
        String token = verify(issue(member));
        String key = key();
        jdbc.execute("alter table rental_operations add constraint test_rental_operation_write check (item_id <> " + itemId + ")");
        try {
            perform(token, key, body(itemId)).andExpect(status().isInternalServerError()).andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"));
            assertEquals(0, count("rentals"));
            assertEquals(0, count("item_status_history"));
            assertEquals(0, count("rental_operations"));
            assertEquals("AVAILABLE", jdbc.queryForObject("select status from items where item_id = ?", String.class, itemId));
            assertEquals(0, jdbc.queryForObject("select count(*) from rental_codes where user_id = ? and consumed_at is not null", Integer.class, userId));
        } finally {
            jdbc.execute("alter table rental_operations drop constraint test_rental_operation_write");
        }
        perform(token, key, body(itemId)).andExpect(status().isCreated());
    }

    @Test void expiresBothNewRequestsAndReplaysAtOriginalGrantDeadline() throws Exception {
        String token = verify(issue(member));
        String key = key();
        perform(token, key, body(itemId)).andExpect(status().isCreated());
        clock.set(NOW.plusSeconds(180));
        perform(token, key, body(itemId)).andExpect(status().isGone()).andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_EXPIRED"));
        perform(token, key(), body(otherItemId)).andExpect(status().isGone());
        assertEquals(1, count("rentals"));
    }

    @Test void failedVerificationAttemptsAreCommittedAndForwardedHeaderCannotBypassLimit() throws Exception {
        for (int n = 0; n < 10; n++) {
            mvc.perform(post("/api/v1/kiosk/rental-grants").contentType("application/json").content("{\"code\":\"000000\"}")
                    .header("X-Forwarded-For", "192.0.2." + n))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("RENTAL_CODE_INVALID"));
        }
        mvc.perform(post("/api/v1/kiosk/rental-grants").contentType("application/json").content("{\"code\":\"000000\"}"))
                .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.error.code").value("RENTAL_VERIFICATION_LIMITED"))
                .andExpect(jsonPath("$.error.retryAt").isString());
        clock.set(NOW.plusSeconds(60));
        verify(issue(member));
    }

    @Test void expiredCodeIsReleasedAndIssueRetryDoesNotCreateNewActiveCodes() throws Exception {
        String first = issue(member);
        assertEquals(first, issue(member));
        clock.set(NOW.plusSeconds(180));
        mvc.perform(post("/api/v1/kiosk/rental-grants").contentType("application/json").content("{\"code\":\"" + first + "\"}"))
                .andExpect(status().isUnauthorized());
        String next = issue(member);
        assertEquals(next, issue(member));
        assertEquals(2, jdbc.queryForObject("select count(*) from rental_codes where user_id = ?", Integer.class, userId));
        assertEquals(1, jdbc.queryForObject("select count(*) from rental_codes where user_id = ? and code_hash is not null", Integer.class, userId));
        verify(next);
    }

    @Test void newCodeIssuanceLimitDoesNotBlockRedisplayOfAnActiveCode() throws Exception {
        String code = null;
        for (int n = 0; n < 10; n++) {
            clock.set(NOW.plusSeconds(n * 180));
            code = issue(member);
        }
        assertEquals(code, issue(member));
        // Keep the mobile session alive while testing the separate hourly code issuance limit.
        jdbc.update("update login_sessions set idle_expires_at = absolute_expires_at where user_id = ?", userId);
        clock.set(NOW.plusSeconds(1800));
        mvc.perform(post("/api/v1/rental-codes").cookie(member).contentType("application/json").content("{}"))
                .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.error.code").value("RENTAL_CODE_ISSUANCE_LIMITED"));
        assertEquals(10, jdbc.queryForObject("select count(*) from rental_codes where user_id = ?", Integer.class, userId));
    }

    @Test void globalVerificationLimitStillAppliesAcrossDifferentAddresses() throws Exception {
        for (int n = 0; n < 60; n++) {
            String address = "192.0.2." + (n / 10 + 1);
            mvc.perform(post("/api/v1/kiosk/rental-grants").with(r -> { r.setRemoteAddr(address); return r; })
                    .contentType("application/json").content("{\"code\":\"000000\"}"))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/v1/kiosk/rental-grants").with(r -> { r.setRemoteAddr("192.0.2.99"); return r; })
                .contentType("application/json").content("{\"code\":\"000000\"}"))
                .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.error.code").value("RENTAL_VERIFICATION_LIMITED"));
    }

    private Cookie session(User user) {
        var browser = browsers.saveAndFlush(new BrowserRegistration(user, secrets.tokenHash(UUID.randomUUID().toString()), NOW.plusSeconds(7200), NOW));
        String token = secrets.generateToken();
        sessions.saveAndFlush(new LoginSession(browser, secrets.tokenHash(token), NOW.plusSeconds(1800), NOW.plusSeconds(3600), NOW));
        return new Cookie(AuthCookies.SESSION_COOKIE, token);
    }
    private long item(ItemType type, String uid) {
        var item = items.saveAndFlush(new Item("API 물품", ItemStatus.TAG_PENDING, type));
        tags.saveAndFlush(new NfcTag(uid, item));
        item.markAvailable(); items.flush();
        return item.getId();
    }
    private String issue(Cookie session) throws Exception {
        JsonNode result = json.readTree(mvc.perform(post("/api/v1/rental-codes").cookie(session).contentType("application/json").content("{}"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andReturn().getResponse().getContentAsString());
        assertTrue(result.get("code").asString().matches("[0-9]{6}"));
        return result.get("code").asString();
    }
    private String verify(String code) throws Exception {
        var result = json.readTree(mvc.perform(post("/api/v1/kiosk/rental-grants").contentType("application/json").content("{\"code\":\"" + code + "\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.maskedPhoneNumber").isString())
                .andReturn().getResponse().getContentAsString());
        return result.get("token").asString();
    }
    private String key() { return UUID.randomUUID().toString(); }
    private String body(long item) { return "{\"itemId\":\"" + item + "\",\"itemTypeId\":\"" + typeId + "\"}"; }
    private MockHttpServletRequestBuilder request(String token, String key, String body) {
        return post("/api/v1/rentals").header("Authorization", "Bearer " + token).header("Idempotency-Key", key).contentType("application/json").content(body);
    }
    private ResultActions perform(String token, String key, String body) throws Exception { return mvc.perform(request(token, key, body)); }
    private int count(String table) {
        return jdbc.queryForObject("select count(*) from " + table + " where item_id in (?, ?)", Integer.class, itemId, otherItemId);
    }
    private void assertRaceConflict(List<MvcResult> responses, String code) throws Exception {
        assertEquals(Set.of(201, 409), new HashSet<>(responses.stream().map(r -> r.getResponse().getStatus()).toList()));
        for (var result : responses) if (result.getResponse().getStatus() == 409) {
            assertEquals(code, json.readTree(result.getResponse().getContentAsString()).get("error").get("code").asString());
        }
    }
    private List<MvcResult> race(Callable<MvcResult> first, Callable<MvcResult> second) throws Exception {
        try (var workers = Executors.newFixedThreadPool(2)) {
            var start = new CountDownLatch(1);
            var ready = new CountDownLatch(2);
            Future<MvcResult> one = workers.submit(() -> { ready.countDown(); start.await(5, TimeUnit.SECONDS); return first.call(); });
            Future<MvcResult> two = workers.submit(() -> { ready.countDown(); start.await(5, TimeUnit.SECONDS); return second.call(); });
            try {
                assertTrue(ready.await(5, TimeUnit.SECONDS)); start.countDown();
                return List.of(one.get(15, TimeUnit.SECONDS), two.get(15, TimeUnit.SECONDS));
            } finally { start.countDown(); workers.shutdownNow(); }
        }
    }
}
