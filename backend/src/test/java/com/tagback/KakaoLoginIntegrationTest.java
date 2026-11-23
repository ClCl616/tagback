package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.controller.KakaoChallengeController;
import com.tagback.domain.entity.LoginSession;
import com.tagback.domain.repository.LoginSessionRepository;
import com.tagback.domain.repository.UserRepository;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.*;
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
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=kakao-auth",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "tagback.auth.common-hash-key=development-test-only-common-key-at-least-32-characters",
        "tagback.kakao.hmac-key=development-test-only-hmac-key-at-least-32-characters",
        "tagback.kakao.skill-secret=development-test-only-header-key-at-least-32-characters",
        "tagback.kakao.bot-id=test-bot"})
@Import(TestAuthClock.TimeConfiguration.class)
class KakaoLoginIntegrationTest {
    @Autowired KakaoChallengeService challenges;
    @Autowired KakaoSignupService signup;
    @Autowired KakaoLoginService login;
    @Autowired LoginService commonLogin;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate db;
    @Autowired WebApplicationContext context;
    @Autowired ObjectMapper json;
    @Autowired AuthSecrets secrets;
    @Autowired TestAuthClock.MutableClock clock;
    @MockitoSpyBean LoginSessionRepository sessions;
    private final List<UUID> challengeIds = new ArrayList<>();
    private final Set<String> identities = new HashSet<>();
    private static final Instant INITIAL = Instant.parse("2026-10-06T09:00:00Z");

    @BeforeEach void setup() { clock.set(INITIAL); }
    @AfterEach void cleanup() {
        for (String identity : identities) {
            var ids = db.queryForList("select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?", Long.class, "test-bot", identity);
            for (Long id : ids) {
                db.update("delete from login_sessions where user_id=?", id);
                db.update("delete from browser_registrations where user_id=?", id);
                db.update("delete from kakao_bot_identities where user_id=?", id);
                db.update("delete from users where user_id=?", id);
            }
        }
        for (UUID id : challengeIds) {
            db.update("delete from auth_operations where caller_scope_hash in (?,?)",
                    secrets.keyedHash("kakao-signup-scope:" + id), secrets.keyedHash("kakao-login-scope:" + id));
            db.update("delete from kakao_auth_challenges where challenge_id=?", id);
        }
    }
    private record Challenge(UUID id, String proof) {}
    private record Account(String identity, long userId, String browser, String session) {}
    private Challenge issue(String purpose, String identity, boolean verified) {
        String proof = challenges.newProof();
        var issued = challenges.issue(purpose, proof, UUID.randomUUID().toString());
        challengeIds.add(issued.id()); identities.add(identity);
        if (verified) assertTrue(challenges.verify(Map.of("bot", Map.of("id", "test-bot"), "userRequest", Map.of(
                "utterance", issued.code(), "user", Map.of("id", identity, "type", "botUserKey"))), UUID.randomUUID().toString()));
        return new Challenge(issued.id(), proof);
    }
    private Account account() {
        String identity = UUID.randomUUID().toString();
        var c = issue("SIGNUP", identity, true);
        var result = signup.signup(new AuthRequests.KakaoSignup(c.id(), "041527", new AuthRequests.Profile("테스트", "학생")), c.proof(), UUID.randomUUID());
        return new Account(identity, Long.parseLong(result.response().user().userId()), result.browserToken(), result.sessionToken());
    }
    private AuthRequests.KakaoNewBrowserLogin input(Challenge c, String pin) { return new AuthRequests.KakaoNewBrowserLogin(c.id(), pin); }
    private AuthException error(AuthErrorCode code, Runnable action) {
        var result = assertThrows(AuthException.class, action::run); assertEquals(code, result.code()); return result;
    }
    private int activeBrowsers(long id) { return db.queryForObject("select count(*) from browser_registrations where user_id=? and revoked_at is null", Integer.class, id); }

    @Test void successfulLoginReplacesOldAccessAndReplaysOnlyToOriginalBrowser() throws Exception {
        var account = account(); var c = issue("LOGIN", account.identity(), true); var key = UUID.randomUUID();
        var request = input(c, "041527"); var body = json.writeValueAsString(request);
        var mvc = webAppContextSetup(context).build();
        mvc.perform(post("/api/v1/auth/kakao/login/new-browser").header("Origin", "https://untrusted.example")
                .header("Idempotency-Key", key).cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof()))
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        var first = mvc.perform(post("/api/v1/auth/kakao/login/new-browser").header("Idempotency-Key", key)
                .cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())).contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.previousBrowserRevoked").value(true))
                .andExpect(jsonPath("$.user.userId").value(Long.toString(account.userId())))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse();
        var retry = mvc.perform(post("/api/v1/auth/kakao/login/new-browser").header("Idempotency-Key", key)
                .cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())).contentType("application/json").content(body))
                .andExpect(status().isOk()).andReturn().getResponse();
        assertEquals(first.getContentAsString(), retry.getContentAsString());
        assertEquals(first.getHeaders("Set-Cookie").stream().map(s -> s.split(";", 2)[0]).toList(),
                retry.getHeaders("Set-Cookie").stream().map(s -> s.split(";", 2)[0]).toList());
        assertEquals(2, first.getHeaders("Set-Cookie").size());
        for (String cookie : first.getHeaders("Set-Cookie")) { assertTrue(cookie.contains("Secure")); assertTrue(cookie.contains("HttpOnly")); }
        String sessionCookie = first.getHeaders("Set-Cookie").stream().filter(s -> s.startsWith(AuthCookies.SESSION_COOKIE + "=")).findFirst().orElseThrow();
        String sessionToken = sessionCookie.substring(sessionCookie.indexOf('=') + 1, sessionCookie.indexOf(';'));
        mvc.perform(get("/api/v1/auth/session").cookie(new Cookie(AuthCookies.SESSION_COOKIE, sessionToken)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.session()), clock.instant()).isEmpty());
        error(AuthErrorCode.BROWSER_REGISTRATION_INVALID, () -> commonLogin.registered(new AuthRequests.RegisteredLogin("041527"), account.browser(), UUID.randomUUID()));
        assertEquals(1, activeBrowsers(account.userId()));
        assertEquals(1, db.queryForObject("select count(*) from login_sessions where user_id=? and revoked_at is null", Integer.class, account.userId()));
        assertEquals("CONSUMED", challenges.status(c.id(), c.proof()).status());
        error(AuthErrorCode.VERIFICATION_CONSUMED, () -> login.newBrowser(request, c.proof(), UUID.randomUUID()));
        error(AuthErrorCode.VERIFICATION_INVALID, () -> login.newBrowser(request, challenges.newProof(), key));
        error(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT, () -> login.newBrowser(input(c, "041528"), c.proof(), key));
    }

    @Test void pinFailuresPersistAndDoNotRevokeOrConsumeAndRetriesAreDeduplicated() {
        var account = account(); var c = issue("LOGIN", account.identity(), true);
        db.update("update users set pin_failed_count=4 where user_id=?", account.userId());
        var wrongKey = UUID.randomUUID();
        var wait = error(AuthErrorCode.PIN_RETRY_WAIT, () -> login.newBrowser(input(c, "041528"), c.proof(), wrongKey));
        assertEquals(INITIAL.plusSeconds(30), wait.retryAt());
        error(AuthErrorCode.PIN_RETRY_WAIT, () -> login.newBrowser(input(c, "041528"), c.proof(), wrongKey));
        error(AuthErrorCode.PIN_RETRY_WAIT, () -> login.newBrowser(input(c, "041527"), c.proof(), UUID.randomUUID()));
        assertEquals(5, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        assertEquals("VERIFIED", challenges.status(c.id(), c.proof()).status());
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.session()), clock.instant()).isPresent());
        clock.advance(Duration.ofSeconds(30));
        login.newBrowser(input(c, "041527"), c.proof(), UUID.randomUUID());
        assertEquals(0, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        assertNull(users.findById(account.userId()).orElseThrow().getPinLockedUntil());
        var blocked = issue("LOGIN", account.identity(), true);
        db.update("update users set pin_failed_count=19 where user_id=?", account.userId());
        error(AuthErrorCode.PIN_LOGIN_BLOCKED, () -> login.newBrowser(input(blocked, "041528"), blocked.proof(), UUID.randomUUID()));
        error(AuthErrorCode.PIN_LOGIN_BLOCKED, () -> login.newBrowser(input(blocked, "041527"), blocked.proof(), UUID.randomUUID()));
        assertEquals(20, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        assertEquals("VERIFIED", challenges.status(blocked.id(), blocked.proof()).status());
    }

    @Test void invalidChallengeOrUnlinkedIdentityCannotLogIn() {
        var account = account();
        var wrong = issue("SIGNUP", account.identity(), true);
        error(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH, () -> login.newBrowser(input(wrong, "041527"), wrong.proof(), UUID.randomUUID()));
        var pending = issue("LOGIN", account.identity(), false);
        error(AuthErrorCode.VERIFICATION_INVALID, () -> login.newBrowser(input(pending, "041527"), pending.proof(), UUID.randomUUID()));
        challenges.cancel(pending.id(), pending.proof());
        error(AuthErrorCode.VERIFICATION_INVALID, () -> login.newBrowser(input(pending, "041527"), pending.proof(), UUID.randomUUID()));
        var missing = issue("LOGIN", UUID.randomUUID().toString(), true);
        error(AuthErrorCode.ACCOUNT_NOT_FOUND, () -> login.newBrowser(input(missing, "041527"), missing.proof(), UUID.randomUUID()));
        var expired = issue("LOGIN", account.identity(), true);
        clock.advance(Duration.ofMinutes(6));
        error(AuthErrorCode.VERIFICATION_EXPIRED, () -> login.newBrowser(input(expired, "041527"), expired.proof(), UUID.randomUUID()));
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.session()), clock.instant()).isPresent());
    }

    @Test void storageFailureRollsBackRevocationAndChallengeConsumption() {
        var account = account(); var c = issue("LOGIN", account.identity(), true);
        doThrow(new IllegalStateException("test persistence failure")).when(sessions).saveAndFlush(any(LoginSession.class));
        assertThrows(IllegalStateException.class, () -> login.newBrowser(input(c, "041527"), c.proof(), UUID.randomUUID()));
        assertEquals("VERIFIED", challenges.status(c.id(), c.proof()).status());
        assertEquals(1, activeBrowsers(account.userId()));
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.session()), clock.instant()).isPresent());
    }

    @Test void concurrentNewBrowserLoginsLeaveOneActiveRegistration() throws Exception {
        var account = account(); var a = issue("LOGIN", account.identity(), true); var b = issue("LOGIN", account.identity(), true);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var fa = pool.submit(() -> { start.await(); return login.newBrowser(input(a, "041527"), a.proof(), UUID.randomUUID()); });
            var fb = pool.submit(() -> { start.await(); return login.newBrowser(input(b, "041527"), b.proof(), UUID.randomUUID()); });
            start.countDown(); fa.get(20, TimeUnit.SECONDS); fb.get(20, TimeUnit.SECONDS);
        }
        assertEquals(1, activeBrowsers(account.userId()));
        assertEquals(1, db.queryForObject("select count(*) from login_sessions where user_id=? and revoked_at is null", Integer.class, account.userId()));
    }
}
