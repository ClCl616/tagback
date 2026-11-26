package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.controller.KakaoChallengeController;
import com.tagback.domain.entity.SessionRevokedReason;
import com.tagback.domain.repository.BrowserRegistrationRepository;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
class KakaoPinResetIntegrationTest {
    @Autowired KakaoChallengeService challenges;
    @Autowired KakaoSignupService signup;
    @Autowired KakaoLoginService login;
    @Autowired KakaoPinResetService reset;
    @Autowired LoginService commonLogin;
    @Autowired UserRepository users;
    @Autowired LoginSessionRepository sessions;
    @Autowired PinService pins;
    @Autowired JdbcTemplate db;
    @Autowired WebApplicationContext context;
    @Autowired ObjectMapper json;
    @Autowired AuthSecrets secrets;
    @Autowired TestAuthClock.MutableClock clock;
    @Autowired PlatformTransactionManager transactions;
    @MockitoSpyBean BrowserRegistrationRepository browsers;
    private final List<UUID> challengeIds = new ArrayList<>();
    private final Set<String> identities = new HashSet<>();

    @BeforeEach void setup() {
        db.update("delete from kakao_auth_rate_limits where scope='skill-global'");
        clock.set(Instant.parse("2026-10-06T09:00:00Z"));
    }
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
            db.update("delete from auth_operations where caller_scope_hash in (?,?,?)",
                    secrets.keyedHash("kakao-signup-scope:" + id), secrets.keyedHash("kakao-login-scope:" + id),
                    secrets.keyedHash("kakao-pin-reset-scope:" + id));
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
    private AuthRequests.KakaoPinReset input(Challenge c, String pin) { return new AuthRequests.KakaoPinReset(c.id(), pin); }
    private void error(AuthErrorCode code, Runnable action) { assertEquals(code, assertThrows(AuthException.class, action::run).code()); }
    private boolean sessionValid(String token) { return sessions.findValidByTokenHash(secrets.tokenHash(token), clock.instant()).isPresent(); }

    @Test void resetRevokesAccessClearsLockAndSupportsSafeRetry() throws Exception {
        var a = account(); var c = issue("PIN_RESET", a.identity(), true); var key = UUID.randomUUID();
        db.update("update users set pin_failed_count=20 where user_id=?", a.userId());
        String body = json.writeValueAsString(input(c, "246802")); var mvc = webAppContextSetup(context).build();
        mvc.perform(post("/api/v1/auth/kakao/pin/reset").header("Origin", "https://untrusted.example")
                .header("Idempotency-Key", key).cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof()))
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        var response = mvc.perform(post("/api/v1/auth/kakao/pin/reset").header("Idempotency-Key", key)
                .cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())).contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.completed").value(true))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse();
        assertEquals(2, response.getHeaders("Set-Cookie").size());
        for (var cookie : response.getHeaders("Set-Cookie")) { assertTrue(cookie.contains("Max-Age=0")); assertTrue(cookie.contains("HttpOnly")); assertTrue(cookie.contains("Secure")); }
        assertTrue(pins.matches("246802", users.findById(a.userId()).orElseThrow().getPinHash()));
        assertFalse(pins.matches("041527", users.findById(a.userId()).orElseThrow().getPinHash()));
        assertEquals(0, users.findById(a.userId()).orElseThrow().getPinFailedCount());
        assertFalse(sessionValid(a.session()));
        assertEquals(SessionRevokedReason.PIN_RESET, sessions.findBySessionTokenHash(secrets.tokenHash(a.session())).orElseThrow().getRevokedReason());
        error(AuthErrorCode.BROWSER_REGISTRATION_INVALID, () -> commonLogin.registered(new AuthRequests.RegisteredLogin("246802"), a.browser(), UUID.randomUUID()));
        assertEquals("CONSUMED", challenges.status(c.id(), c.proof()).status());
        error(AuthErrorCode.VERIFICATION_CONSUMED, () -> reset.reset(input(c, "246802"), c.proof(), UUID.randomUUID()));
        error(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT, () -> reset.reset(input(c, "246803"), c.proof(), key));
        error(AuthErrorCode.VERIFICATION_INVALID, () -> reset.reset(input(c, "246802"), challenges.newProof(), key));
        var loginChallenge = issue("LOGIN", a.identity(), true);
        var newLogin = login.newBrowser(new AuthRequests.KakaoNewBrowserLogin(loginChallenge.id(), "246802"), loginChallenge.proof(), UUID.randomUUID());
        mvc.perform(post("/api/v1/auth/kakao/pin/reset").header("Idempotency-Key", key)
                .cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof()), new Cookie(AuthCookies.SESSION_COOKIE, newLogin.sessionToken()))
                .contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.completed").value(true))
                .andExpect(header().doesNotExist("Set-Cookie"));
        assertTrue(sessionValid(newLogin.sessionToken()));
    }

    @Test void wrongPurposeProofIdentityOrExpirationCannotResetAnotherAccount() {
        var a = account(); var b = account();
        var signupProof = issue("SIGNUP", a.identity(), true);
        error(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH, () -> reset.reset(input(signupProof, "246802"), signupProof.proof(), UUID.randomUUID()));
        var loginProof = issue("LOGIN", a.identity(), true);
        error(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH, () -> reset.reset(input(loginProof, "246802"), loginProof.proof(), UUID.randomUUID()));
        var pending = issue("PIN_RESET", a.identity(), false);
        error(AuthErrorCode.VERIFICATION_INVALID, () -> reset.reset(input(pending, "246802"), pending.proof(), UUID.randomUUID()));
        challenges.cancel(pending.id(), pending.proof());
        error(AuthErrorCode.VERIFICATION_INVALID, () -> reset.reset(input(pending, "246802"), pending.proof(), UUID.randomUUID()));
        var unlinked = issue("PIN_RESET", UUID.randomUUID().toString(), true);
        error(AuthErrorCode.ACCOUNT_NOT_FOUND, () -> reset.reset(input(unlinked, "246802"), unlinked.proof(), UUID.randomUUID()));
        var owned = issue("PIN_RESET", b.identity(), true);
        error(AuthErrorCode.VERIFICATION_INVALID, () -> reset.reset(input(owned, "246802"), challenges.newProof(), UUID.randomUUID()));
        reset.reset(input(owned, "246802"), owned.proof(), UUID.randomUUID());
        assertTrue(pins.matches("041527", users.findById(a.userId()).orElseThrow().getPinHash()));
        assertTrue(sessionValid(a.session()));
        assertTrue(pins.matches("246802", users.findById(b.userId()).orElseThrow().getPinHash()));
        var expired = issue("PIN_RESET", a.identity(), true);
        clock.advance(Duration.ofMinutes(6));
        error(AuthErrorCode.VERIFICATION_EXPIRED, () -> reset.reset(input(expired, "246802"), expired.proof(), UUID.randomUUID()));
        assertTrue(pins.matches("041527", users.findById(a.userId()).orElseThrow().getPinHash()));
        assertTrue(sessionValid(a.session()));
    }

    @Test void persistenceFailureRollsBackPinChallengeAndRevocations() {
        var a = account(); var c = issue("PIN_RESET", a.identity(), true);
        new TransactionTemplate(transactions).executeWithoutResult(status ->
                doThrow(new IllegalStateException("test storage failure")).when(browsers).revokeAllForUser(eq(a.userId()), any(Instant.class)));
        assertThrows(IllegalStateException.class, () -> reset.reset(input(c, "246802"), c.proof(), UUID.randomUUID()));
        assertTrue(pins.matches("041527", users.findById(a.userId()).orElseThrow().getPinHash()));
        assertEquals("VERIFIED", challenges.status(c.id(), c.proof()).status());
        assertTrue(sessionValid(a.session()));
        assertEquals(1, db.queryForObject("select count(*) from browser_registrations where user_id=? and revoked_at is null", Integer.class, a.userId()));
    }

    @Test void concurrentUsesOfOneChallengeOnlyResetOnce() throws Exception {
        var a = account(); var c = issue("PIN_RESET", a.identity(), true); var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var x = pool.submit(() -> attempt(c, start)); var y = pool.submit(() -> attempt(c, start));
            start.countDown();
            assertEquals(Set.of("OK", "VERIFICATION_CONSUMED"), Set.of(x.get(20, TimeUnit.SECONDS), y.get(20, TimeUnit.SECONDS)));
        }
        assertTrue(pins.matches("246802", users.findById(a.userId()).orElseThrow().getPinHash()));
        assertFalse(sessionValid(a.session()));
    }
    private String attempt(Challenge c, CountDownLatch start) throws InterruptedException {
        start.await();
        try { reset.reset(input(c, "246802"), c.proof(), UUID.randomUUID()); return "OK"; }
        catch (AuthException e) { return e.code().name(); }
    }
}
