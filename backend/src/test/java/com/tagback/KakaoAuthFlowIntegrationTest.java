package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.controller.KakaoChallengeController;
import com.tagback.service.AuthSecrets;
import com.tagback.service.AccountWithdrawalService;
import com.tagback.service.RentalCheckoutService;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup;

/** HTTP-level Kakao format tests against an isolated PostgreSQL instance, without a live Kakao channel. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=kakao-auth",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "tagback.auth.common-hash-key=development-test-only-common-key-at-least-32-characters",
        "tagback.kakao.hmac-key=development-test-only-hmac-key-at-least-32-characters",
        "tagback.kakao.skill-secret=development-test-only-header-key-at-least-32-characters",
        "tagback.kakao.bot-id=test-bot"})
@Import(TestAuthClock.TimeConfiguration.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class KakaoAuthFlowIntegrationTest {
    private static final String ROOT = "/api/v1/auth/kakao";
    private static final String SECRET = "development-test-only-header-key-at-least-32-characters";
    @Autowired WebApplicationContext context;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired AuthSecrets secrets;
    @Autowired AccountWithdrawalService withdrawal;
    @Autowired RentalCheckoutService checkout;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired TestAuthClock.MutableClock clock;
    private MockMvc mvc;
    private final List<UUID> challengeIds = new ArrayList<>();
    private final Set<String> identities = new HashSet<>();

    @BeforeEach void setup() {
        db.update("delete from kakao_auth_rate_limits where scope='skill-global'");
        clock.set(Instant.parse("2026-10-06T09:00:00Z"));
        mvc = webAppContextSetup(context).build();
    }
    @AfterEach void cleanup() {
        db.update("delete from kakao_auth_rate_limits where scope='skill-global'");
        for (String identity : identities) {
            for (Long id : db.queryForList("select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?", Long.class, "test-bot", identity)) {
                db.update("delete from login_sessions where user_id=?", id);
                db.update("delete from browser_registrations where user_id=?", id);
                db.update("delete from kakao_bot_identities where user_id=?", id);
                db.update("delete from users where user_id=?", id);
            }
        }
        for (UUID id : challengeIds) {
            db.update("delete from auth_operations where caller_scope_hash in (?,?,?)", secrets.keyedHash("kakao-signup-scope:" + id),
                    secrets.keyedHash("kakao-login-scope:" + id), secrets.keyedHash("kakao-pin-reset-scope:" + id));
            db.update("delete from kakao_auth_challenges where challenge_id=?", id);
        }
    }
    private record Challenge(UUID id, String code, String proof) {}
    private Challenge issue(String purpose) throws Exception {
        var response = mvc.perform(post(ROOT + "/challenges").contentType("application/json")
                .content(json.writeValueAsString(Map.of("purpose", purpose)))
                .with(req -> { req.setRemoteAddr(UUID.randomUUID().toString()); return req; }))
                .andExpect(status().isCreated()).andReturn().getResponse();
        var body = json.readTree(response.getContentAsString());
        var id = UUID.fromString(body.get("id").asText()); challengeIds.add(id);
        return new Challenge(id, body.get("code").asText(), cookie(response, KakaoChallengeController.PROOF_COOKIE));
    }
    private String cookie(MockHttpServletResponse response, String name) {
        String header = response.getHeaders("Set-Cookie").stream().filter(s -> s.startsWith(name + "=")).findFirst().orElseThrow();
        return header.substring(header.indexOf('=') + 1, header.indexOf(';'));
    }
    private String skillBody(Challenge c, String identity) {
        return json.writeValueAsString(Map.of("bot", Map.of("id", "test-bot"), "userRequest", Map.of(
                "utterance", c.code(), "user", Map.of("type", "botUserKey", "id", identity))));
    }
    private void verify(Challenge c, String identity) throws Exception {
        identities.add(identity);
        mvc.perform(post(ROOT + "/skill").contentType("application/json").header("X-Tagback-Skill-Secret", SECRET)
                .content(skillBody(c, identity)).with(req -> { req.setRemoteAddr(UUID.randomUUID().toString()); return req; }))
                .andExpect(status().isOk()).andExpect(jsonPath("$.template.outputs[0].simpleText.text").value("인증 요청을 확인했습니다. 원래 화면으로 돌아가 진행해 주세요."));
        mvc.perform(get(ROOT + "/challenges/" + c.id()).cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("VERIFIED"));
    }
    private String payload(String action, Challenge c, String pin) {
        if ("SIGNUP".equals(action)) return json.writeValueAsString(Map.of("challengeId", c.id(), "pin", pin,
                "profile", Map.of("name", "통합 테스트", "occupation", "학생")));
        return json.writeValueAsString(Map.of("challengeId", c.id(), "pin", pin));
    }
    private String path(String action) {
        return switch (action) { case "SIGNUP" -> "/signup"; case "LOGIN" -> "/login/new-browser"; case "PIN_RESET" -> "/pin/reset"; default -> throw new IllegalArgumentException(); };
    }
    private MockHttpServletResponse submit(String action, Challenge c, String pin, UUID key, int expected) throws Exception {
        var response = mvc.perform(post(ROOT + path(action)).header("Idempotency-Key", key)
                .cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof()))
                .contentType("application/json").content(payload(action, c, pin))).andReturn().getResponse();
        assertEquals(expected, response.getStatus(), response.getContentAsString());
        return response;
    }
    private void error(MockHttpServletResponse response, String code) throws Exception {
        assertEquals(code, json.readTree(response.getContentAsString()).get("error").get("code").asText());
    }
    private void session(String token, int statusCode) throws Exception {
        var response = mvc.perform(get("/api/v1/auth/session").cookie(new Cookie(AuthCookies.SESSION_COOKIE, token)))
                .andReturn().getResponse();
        assertEquals(statusCode, response.getStatus());
    }

    @Test void signupLoginResetAndNewPinLoginWorkAcrossHttpAndRetries() throws Exception {
        String identity = UUID.randomUUID().toString();
        var signup = issue("SIGNUP"); verify(signup, identity);
        var signupKey = UUID.randomUUID();
        var firstSignup = submit("SIGNUP", signup, "041527", signupKey, 201);
        var retrySignup = submit("SIGNUP", signup, "041527", signupKey, 201);
        assertEquals(firstSignup.getContentAsString(), retrySignup.getContentAsString());
        assertEquals(cookie(firstSignup, AuthCookies.SESSION_COOKIE), cookie(retrySignup, AuthCookies.SESSION_COOKIE));
        String originalSession = cookie(firstSignup, AuthCookies.SESSION_COOKIE);
        String originalBrowser = cookie(firstSignup, AuthCookies.BROWSER_COOKIE);
        session(originalSession, 200);
        error(submit("SIGNUP", signup, "041527", UUID.randomUUID(), 409), "VERIFICATION_CONSUMED");
        error(submit("SIGNUP", signup, "920314", signupKey, 409), "IDEMPOTENCY_KEY_CONFLICT");

        var login = issue("LOGIN"); verify(login, identity);
        var badKey = UUID.randomUUID();
        error(submit("LOGIN", login, "041528", badKey, 401), "PIN_MISMATCH");
        error(submit("LOGIN", login, "041528", badKey, 401), "PIN_MISMATCH");
        session(originalSession, 200);
        var loginKey = UUID.randomUUID();
        var firstLogin = submit("LOGIN", login, "041527", loginKey, 200);
        var retryLogin = submit("LOGIN", login, "041527", loginKey, 200);
        assertEquals(firstLogin.getContentAsString(), retryLogin.getContentAsString());
        assertEquals(cookie(firstLogin, AuthCookies.SESSION_COOKIE), cookie(retryLogin, AuthCookies.SESSION_COOKIE));
        String loginSession = cookie(firstLogin, AuthCookies.SESSION_COOKIE);
        String loginBrowser = cookie(firstLogin, AuthCookies.BROWSER_COOKIE);
        assertTrue(json.readTree(firstLogin.getContentAsString()).get("previousBrowserRevoked").asBoolean());
        session(originalSession, 401); session(loginSession, 200);
        mvc.perform(post("/api/v1/auth/login/registered").header("Idempotency-Key", UUID.randomUUID())
                .cookie(new Cookie(AuthCookies.BROWSER_COOKIE, originalBrowser)).contentType("application/json").content("{\"pin\":\"041527\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("BROWSER_REGISTRATION_INVALID"));
        error(submit("LOGIN", login, "041527", UUID.randomUUID(), 409), "VERIFICATION_CONSUMED");
        error(submit("LOGIN", login, "041528", loginKey, 409), "IDEMPOTENCY_KEY_CONFLICT");

        var reset = issue("PIN_RESET"); verify(reset, identity); var resetKey = UUID.randomUUID();
        var resetResponse = submit("PIN_RESET", reset, "246802", resetKey, 200);
        assertTrue(json.readTree(resetResponse.getContentAsString()).get("completed").asBoolean());
        assertEquals(2, resetResponse.getHeaders("Set-Cookie").size());
        session(loginSession, 401);
        mvc.perform(post("/api/v1/auth/login/registered").header("Idempotency-Key", UUID.randomUUID())
                .cookie(new Cookie(AuthCookies.BROWSER_COOKIE, loginBrowser)).contentType("application/json").content("{\"pin\":\"246802\"}"))
                .andExpect(status().isUnauthorized());
        assertEquals(200, submit("PIN_RESET", reset, "246802", resetKey, 200).getStatus());
        error(submit("PIN_RESET", reset, "246802", UUID.randomUUID(), 409), "VERIFICATION_CONSUMED");
        error(submit("PIN_RESET", reset, "246803", resetKey, 409), "IDEMPOTENCY_KEY_CONFLICT");

        var relogin = issue("LOGIN"); verify(relogin, identity);
        error(submit("LOGIN", relogin, "041527", UUID.randomUUID(), 401), "PIN_MISMATCH");
        var newLogin = submit("LOGIN", relogin, "246802", UUID.randomUUID(), 200);
        String newSession = cookie(newLogin, AuthCookies.SESSION_COOKIE); session(newSession, 200);
        var retryReset = submit("PIN_RESET", reset, "246802", resetKey, 200);
        assertTrue(retryReset.getHeaders("Set-Cookie").isEmpty()); session(newSession, 200);
        assertEquals(1, db.queryForObject("select count(*) from kakao_bot_identities where bot_id=? and bot_user_key=?", Integer.class, "test-bot", identity));
    }

    @Test void allSixCrossPurposeUsesAreRejectedWithoutConsumingRequests() throws Exception {
        for (String purpose : List.of("SIGNUP", "LOGIN", "PIN_RESET")) {
            var c = issue(purpose); verify(c, UUID.randomUUID().toString());
            for (String action : List.of("SIGNUP", "LOGIN", "PIN_RESET")) {
                if (!purpose.equals(action)) error(submit(action, c, "041527", UUID.randomUUID(), 403), "VERIFICATION_PURPOSE_MISMATCH");
            }
            mvc.perform(get(ROOT + "/challenges/" + c.id()).cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("VERIFIED"));
        }
    }

    @Test void secretBrowserCancellationAndExpiryAreEnforcedAcrossHttp() throws Exception {
        String identity = UUID.randomUUID().toString();
        var c = issue("SIGNUP");
        mvc.perform(post(ROOT + "/skill").contentType("application/json").content(skillBody(c, identity)))
                .andExpect(status().isForbidden());
        mvc.perform(get(ROOT + "/challenges/" + c.id())).andExpect(status().isUnauthorized());
        verify(c, identity);
        mvc.perform(delete(ROOT + "/challenges/" + c.id()).cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())))
                .andExpect(status().isNoContent());
        error(submit("SIGNUP", c, "041527", UUID.randomUUID(), 401), "VERIFICATION_INVALID");
        var expired = issue("PIN_RESET"); verify(expired, UUID.randomUUID().toString());
        clock.advance(Duration.ofMinutes(6));
        error(submit("PIN_RESET", expired, "246802", UUID.randomUUID(), 410), "VERIFICATION_EXPIRED");
    }

    @Test void withdrawalBlocksOutstandingRentalsThenDetachesHistoryAndAllowsFreshSignup() throws Exception {
        String identity = UUID.randomUUID().toString();
        var signup = issue("SIGNUP"); verify(signup, identity);
        var signupKey = UUID.randomUUID();
        var created = submit("SIGNUP", signup, "041527", signupKey, 201);
        long userId = json.readTree(created.getContentAsString()).get("user").get("userId").asLong();
        String token = cookie(created, AuthCookies.SESSION_COOKIE);
        long typeId = db.queryForObject("insert into item_types(name) values (?) returning item_type_id", Long.class, "withdrawal-" + UUID.randomUUID());
        long itemId = db.queryForObject("insert into items(item_type_id,item_name,status) values (?,?,'TAG_PENDING') returning item_id", Long.class, typeId, "withdrawal fixture");
        try {
            long rentalId = db.queryForObject("insert into rentals(user_id,item_id,rented_at,due_at,status) values (?,?,?,?,'OVERDUE') returning rental_id", Long.class,
                    userId, itemId, java.sql.Timestamp.from(clock.instant().minusSeconds(86400)), java.sql.Timestamp.from(clock.instant().minusSeconds(3600)));
            mvc.perform(delete("/api/v1/account").header("X-Expected-User-Id", userId + 1).cookie(new Cookie(AuthCookies.SESSION_COOKIE, token)))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("ACCOUNT_CHANGED"));
            mvc.perform(delete("/api/v1/account").header("X-Expected-User-Id", userId).cookie(new Cookie(AuthCookies.SESSION_COOKIE, token)))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("OUTSTANDING_RENTALS"));
            session(token, 200);
            db.update("update rentals set status='RETURNED', returned_at=?, return_condition='NORMAL' where rental_id=?", java.sql.Timestamp.from(clock.instant()), rentalId);
            db.update("insert into item_status_history(item_id,from_status,to_status,source,changed_by_user_id) values (?,'TAG_PENDING','RENTED','ADMIN_API',?)", itemId, userId);
            assertThrows(IllegalStateException.class, () -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                withdrawal.withdraw(token);
                throw new IllegalStateException("simulate later transaction failure");
            }));
            assertEquals(1, db.queryForObject("select count(*) from rentals where rental_id=? and user_id=?", Integer.class, rentalId, userId));
            assertEquals(0, db.queryForObject("select count(*) from withdrawn_rental_history where item_id=?", Integer.class, itemId));
            session(token, 200);
            var codeResponse = mvc.perform(post("/api/v1/rental-codes").cookie(new Cookie(AuthCookies.SESSION_COOKIE, token))
                    .contentType("application/json").content("{}")).andExpect(status().isOk()).andReturn().getResponse();
            var rentalCode = json.readTree(codeResponse.getContentAsString()).get("code").asText();
            var grantResponse = mvc.perform(post("/api/v1/kiosk/rental-grants").contentType("application/json")
                    .content(json.writeValueAsString(Map.of("code", rentalCode)))).andExpect(status().isCreated()).andReturn().getResponse();
            String grant = json.readTree(grantResponse.getContentAsString()).get("token").asText();
            mvc.perform(delete("/api/v1/account").header("Origin", "https://untrusted.example")
                    .cookie(new Cookie(AuthCookies.SESSION_COOKIE, token))).andExpect(status().isForbidden());
            session(token, 200);
            var deleted = mvc.perform(delete("/api/v1/account").header("X-Expected-User-Id", userId).cookie(new Cookie(AuthCookies.SESSION_COOKIE, token)))
                    .andExpect(status().isNoContent()).andReturn().getResponse();
            assertEquals(2, deleted.getHeaders("Set-Cookie").size());
            session(token, 401);
            mvc.perform(get("/api/v1/item-types").header("Authorization", "Bearer " + grant))
                    .andExpect(status().isUnauthorized());
            assertEquals(0, db.queryForObject("select count(*) from rental_codes where user_id=?", Integer.class, userId));
            assertEquals(0, db.queryForObject("select count(*) from users where user_id=?", Integer.class, userId));
            assertEquals(0, db.queryForObject("select count(*) from kakao_auth_challenges where challenge_id=?", Integer.class, signup.id()));
            assertEquals(0, db.queryForObject("select count(*) from auth_operations where caller_scope_hash=?", Integer.class, secrets.keyedHash("kakao-signup-scope:" + signup.id())));
            error(submit("SIGNUP", signup, "041527", signupKey, 401), "VERIFICATION_INVALID");
            assertEquals(0, db.queryForObject("select count(*) from rentals where rental_id=?", Integer.class, rentalId));
            assertEquals(1, db.queryForObject("select count(*) from withdrawn_rental_history where item_id=?", Integer.class, itemId));
            assertEquals(1, db.queryForObject("select count(*) from item_status_history where item_id=? and changed_by_user_id is null and actor_withdrawn", Integer.class, itemId));
            var again = issue("SIGNUP"); verify(again, identity);
            long newId = json.readTree(submit("SIGNUP", again, "041527", UUID.randomUUID(), 201).getContentAsString()).get("user").get("userId").asLong();
            assertNotEquals(userId, newId);
            assertEquals(0, db.queryForObject("select count(*) from rentals where user_id=?", Integer.class, newId));
            clock.set(clock.instant().atZone(java.time.ZoneOffset.UTC).plusYears(1).minusSeconds(1).toInstant());
            withdrawal.deleteExpiredHistory();
            assertEquals(1, db.queryForObject("select count(*) from withdrawn_rental_history where item_id=?", Integer.class, itemId));
            clock.advance(Duration.ofSeconds(1)); withdrawal.deleteExpiredHistory();
            assertEquals(0, db.queryForObject("select count(*) from withdrawn_rental_history where item_id=?", Integer.class, itemId));
        } finally {
            db.update("delete from withdrawn_rental_history where item_id=?", itemId);
            db.update("delete from item_status_history where item_id=?", itemId);
            db.update("delete from rentals where item_id=?", itemId);
            db.update("delete from items where item_id=?", itemId);
            db.update("delete from item_types where item_type_id=?", typeId);
        }
    }

    @Test void concurrentCheckoutMustFinishBeforeWithdrawalRechecksOutstandingRentals() throws Exception {
        String identity = UUID.randomUUID().toString();
        var signup = issue("SIGNUP"); verify(signup, identity);
        var created = submit("SIGNUP", signup, "041527", UUID.randomUUID(), 201);
        long userId = json.readTree(created.getContentAsString()).get("user").get("userId").asLong();
        String token = cookie(created, AuthCookies.SESSION_COOKIE);
        long typeId = db.queryForObject("insert into item_types(name) values (?) returning item_type_id", Long.class, "race-" + UUID.randomUUID());
        long itemId = db.queryForObject("insert into items(item_type_id,item_name,status) values (?,?,'TAG_PENDING') returning item_id", Long.class, typeId, "race fixture");
        db.update("insert into nfc_tags(item_id,tag_uid) values (?,?)", itemId, "04" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase());
        db.update("update items set status='AVAILABLE' where item_id=?", itemId);
        var executor = Executors.newFixedThreadPool(2);
        var checkoutReady = new CountDownLatch(1);
        var allowCommit = new CountDownLatch(1);
        try {
            var rental = executor.submit(() -> new TransactionTemplate(transactionManager).execute(status -> {
                var result = checkout.checkout(userId, itemId, typeId);
                checkoutReady.countDown();
                try { if (!allowCommit.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out"); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                return result;
            }));
            assertTrue(checkoutReady.await(10, TimeUnit.SECONDS));
            var deletion = executor.submit(() -> mvc.perform(delete("/api/v1/account")
                    .header("X-Expected-User-Id", userId)
                    .cookie(new Cookie(AuthCookies.SESSION_COOKIE, token))).andReturn().getResponse());
            assertThrows(TimeoutException.class, () -> deletion.get(300, TimeUnit.MILLISECONDS));
            allowCommit.countDown();
            assertNotNull(rental.get(10, TimeUnit.SECONDS));
            var response = deletion.get(10, TimeUnit.SECONDS);
            assertEquals(409, response.getStatus(), response.getContentAsString());
            error(response, "OUTSTANDING_RENTALS");
            assertEquals(1, db.queryForObject("select count(*) from users where user_id=?", Integer.class, userId));
            assertEquals(1, db.queryForObject("select count(*) from rentals where user_id=? and returned_at is null", Integer.class, userId));
        } finally {
            allowCommit.countDown(); executor.shutdownNow(); executor.awaitTermination(10, TimeUnit.SECONDS);
            db.update("delete from item_status_history where item_id=?", itemId);
            db.update("delete from rentals where item_id=?", itemId);
            db.update("delete from nfc_tags where item_id=?", itemId);
            db.update("delete from items where item_id=?", itemId);
            db.update("delete from item_types where item_type_id=?", typeId);
        }
    }

    @Test void checkoutCannotCreateRentalAfterConcurrentWithdrawalCommits() throws Exception {
        String identity = UUID.randomUUID().toString();
        var signup = issue("SIGNUP"); verify(signup, identity);
        var created = submit("SIGNUP", signup, "041527", UUID.randomUUID(), 201);
        long userId = json.readTree(created.getContentAsString()).get("user").get("userId").asLong();
        String token = cookie(created, AuthCookies.SESSION_COOKIE);
        long typeId = db.queryForObject("insert into item_types(name) values (?) returning item_type_id", Long.class, "race-deleted-" + UUID.randomUUID());
        long itemId = db.queryForObject("insert into items(item_type_id,item_name,status) values (?,?,'TAG_PENDING') returning item_id", Long.class, typeId, "race fixture");
        var executor = Executors.newFixedThreadPool(2);
        var removed = new CountDownLatch(1);
        var allowCommit = new CountDownLatch(1);
        try {
            var deletion = executor.submit(() -> new TransactionTemplate(transactionManager).execute(status -> {
                withdrawal.withdraw(token);
                removed.countDown();
                try { if (!allowCommit.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out"); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                return true;
            }));
            assertTrue(removed.await(10, TimeUnit.SECONDS));
            var rental = executor.submit(() -> checkout.checkout(userId, itemId, typeId));
            assertThrows(TimeoutException.class, () -> rental.get(300, TimeUnit.MILLISECONDS));
            allowCommit.countDown();
            assertTrue(deletion.get(10, TimeUnit.SECONDS));
            var failure = assertThrows(ExecutionException.class, () -> rental.get(10, TimeUnit.SECONDS));
            assertInstanceOf(com.tagback.exception.AuthException.class, failure.getCause());
            assertEquals(0, db.queryForObject("select count(*) from rentals where user_id=?", Integer.class, userId));
        } finally {
            allowCommit.countDown(); executor.shutdownNow(); executor.awaitTermination(10, TimeUnit.SECONDS);
            db.update("delete from items where item_id=?", itemId);
            db.update("delete from item_types where item_type_id=?", typeId);
        }
    }
}
