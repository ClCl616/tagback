package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.domain.entity.SessionRevokedReason;
import com.tagback.domain.repository.LoginSessionRepository;
import com.tagback.dto.auth.*;
import com.tagback.service.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.context.WebApplicationContext;
import java.time.*;
import java.sql.Timestamp;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=kakao-auth",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password="})
@Import(TestAuthClock.TimeConfiguration.class)
class SessionApiIntegrationTest {
    @Autowired WebApplicationContext context;
    @Autowired SessionService service;
    @Autowired KakaoSignupService signup;
    @Autowired KakaoChallengeService challenges;
    @Autowired KakaoLoginService kakaoLogin;
    @Autowired LoginService login;
    @Autowired AuthSecrets secrets;
    @Autowired LoginSessionRepository sessions;
    @Autowired TestAuthClock.MutableClock clock;
    @Autowired JdbcTemplate jdbc;
    private MockMvc mvc;
    private final List<String> identities = new ArrayList<>();
    private final List<UUID> challengeIds = new ArrayList<>();
    private final Instant initial = Instant.parse("2026-10-06T09:00:00Z");

    @BeforeEach void setup() {
        clock.set(initial);
        mvc = webAppContextSetup(context).build();
    }
    @AfterEach void cleanup() {
        for (String identity : identities) {
            var ids = jdbc.queryForList("select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?", Long.class, "test-bot", identity);
            for (Long id : ids) {
                for (UUID browser : jdbc.query("select browser_registration_id from browser_registrations where user_id=?", (row, n) -> row.getObject(1, UUID.class), id))
                    jdbc.update("delete from auth_operations where caller_scope_hash=?", secrets.tokenHash("registered-login:" + browser));
                jdbc.update("delete from login_sessions where user_id=?", id);
                jdbc.update("delete from browser_registrations where user_id=?", id);
                jdbc.update("delete from kakao_bot_identities where user_id=?", id);
                jdbc.update("delete from users where user_id=?", id);
            }
        }
        for (UUID id : challengeIds) {
            jdbc.update("delete from auth_operations where caller_scope_hash in (?,?)", secrets.keyedHash("kakao-signup-scope:" + id), secrets.keyedHash("kakao-login-scope:" + id));
            jdbc.update("delete from kakao_auth_challenges where challenge_id=?", id);
        }
    }
    private record Challenge(UUID id, String proof) {}
    private Challenge challenge(String identity, String purpose) {
        String proof = challenges.newProof();
        var issued = challenges.issue(purpose, proof, UUID.randomUUID().toString());
        challengeIds.add(issued.id());
        // Session tests use a verified fixture; the skill and rate limits have their own integration tests.
        jdbc.update("update kakao_auth_challenges set status='VERIFIED', bot_id='test-bot', bot_user_key=?, verified_at=? where challenge_id=?",
                identity, Timestamp.from(clock.instant()), issued.id());
        return new Challenge(issued.id(), proof);
    }
    private Fixture account() {
        String identity = UUID.randomUUID().toString(); identities.add(identity);
        var c = challenge(identity, "SIGNUP");
        var result = signup.signup(new AuthRequests.KakaoSignup(c.id(), "041527", new AuthRequests.Profile("테스트", "학생")), c.proof(), UUID.randomUUID());
        return new Fixture(identity, result.browserToken(), result.sessionToken());
    }
    private Cookie session(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
    private Cookie browser(String token) { return new Cookie(AuthCookies.BROWSER_COOKIE, token); }

    @Test void pollingDoesNotExtendActivityLogoutKeepsRegistrationAndRemovalEndsBoth() throws Exception {
        var account = account();
        mvc.perform(get("/api/v1/auth/browser-registration")).andExpect(status().isOk()).andExpect(jsonPath("$.registered").value(false));
        mvc.perform(get("/api/v1/auth/session")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        clock.advance(Duration.ofMinutes(20));
        mvc.perform(get("/api/v1/auth/session").cookie(session(account.session())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sessionExpiresAt").value("2026-10-06T09:30:00Z"));
        mvc.perform(post("/api/v1/auth/session/activity").cookie(session(account.session())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sessionExpiresAt").value("2026-10-06T09:50:00Z"));
        mvc.perform(delete("/api/v1/auth/browser-registration").cookie(browser(account.browser()), session(account.session()))
                        .header("Origin", "https://untrusted.example")).andExpect(status().isForbidden());
        var logout = mvc.perform(post("/api/v1/auth/logout").cookie(session(account.session())))
                .andExpect(status().isNoContent()).andReturn().getResponse();
        assertEquals(1, logout.getHeaders("Set-Cookie").size());
        assertTrue(logout.getHeader("Set-Cookie").contains("Max-Age=0"));
        mvc.perform(get("/api/v1/auth/browser-registration").cookie(browser(account.browser())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.registered").value(true));
        var again = login.registered(new AuthRequests.RegisteredLogin("041527"), account.browser(), UUID.randomUUID());
        mvc.perform(delete("/api/v1/auth/browser-registration").cookie(browser(account.browser()), session(again.sessionToken())))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/auth/session").cookie(session(again.sessionToken())))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        mvc.perform(get("/api/v1/auth/browser-registration").cookie(browser(account.browser())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.registered").value(false));
        mvc.perform(post("/api/v1/auth/logout")).andExpect(status().isNoContent());
        mvc.perform(delete("/api/v1/auth/browser-registration")).andExpect(status().isNoContent());
    }

    @Test void idleAndAbsoluteExpiryAreEnforcedAndExpiredSessionsCannotRevive() throws Exception {
        var account = account();
        clock.advance(Duration.ofMinutes(30));
        mvc.perform(get("/api/v1/auth/session").cookie(session(account.session())))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_EXPIRED"));
        assertEquals(SessionRevokedReason.EXPIRED, sessions.findBySessionTokenHash(secrets.tokenHash(account.session())).orElseThrow().getRevokedReason());
        mvc.perform(post("/api/v1/auth/session/activity").cookie(session(account.session())))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_EXPIRED"));
        assertTrue(service.registration(account.browser()).registered());
        clock.set(initial);
        var active = account();
        // Fixture represents continued activity during the first 7.5 hours.
        jdbc.update("update login_sessions set last_activity_at = ?, idle_expires_at = ? where session_token_hash = ?",
                Timestamp.from(initial.plus(Duration.ofMinutes(450))), Timestamp.from(initial.plus(Duration.ofHours(8))), secrets.tokenHash(active.session()));
        clock.set(initial.plus(Duration.ofMinutes(465)));
        assertEquals(initial.plus(Duration.ofHours(8)), service.activity(active.session()).sessionExpiresAt());
        clock.set(initial.plus(Duration.ofHours(8)));
        mvc.perform(get("/api/v1/auth/session").cookie(session(active.session())))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_EXPIRED"));
        clock.set(initial.plus(Duration.ofDays(30)));
        assertFalse(service.registration(active.browser()).registered());
    }

    @Test void replacedSessionHasSpecificErrorAndStaleLogoutRemovalDoNotAffectNewBrowser() throws Exception {
        var old = account();
        clock.advance(Duration.ofMinutes(1));
        var c = challenge(old.identity(), "LOGIN");
        var replacement = kakaoLogin.newBrowser(new AuthRequests.KakaoNewBrowserLogin(c.id(), "041527"), c.proof(), UUID.randomUUID());
        mvc.perform(get("/api/v1/auth/session").cookie(session(old.session())))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REPLACED"));
        mvc.perform(post("/api/v1/auth/logout").cookie(session(old.session()))).andExpect(status().isNoContent());
        mvc.perform(delete("/api/v1/auth/browser-registration").cookie(browser(old.browser()), session(old.session()))).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/auth/session").cookie(session(replacement.sessionToken())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
        assertTrue(service.registration(replacement.browserToken()).registered());
    }
    private record Fixture(String identity, String browser, String session) {
        @Override public String toString() { return "Fixture[redacted]"; }
    }
}
