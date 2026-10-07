package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.domain.entity.SessionRevokedReason;
import com.tagback.domain.repository.LoginSessionRepository;
import com.tagback.dto.auth.*;
import com.tagback.service.*;
import com.tagback.service.sms.*;
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
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password="})
@Import(SmsMockApiIntegrationTest.TimeConfiguration.class)
class SessionApiIntegrationTest {
    @Autowired WebApplicationContext context;
    @Autowired SessionService service;
    @Autowired SignupService signup;
    @Autowired LoginService login;
    @Autowired SmsAuthService sms;
    @Autowired SmsSecrets secrets;
    @Autowired LoginSessionRepository sessions;
    @Autowired SmsMockApiIntegrationTest.MutableClock clock;
    @Autowired JdbcTemplate jdbc;
    private MockMvc mvc;
    private final List<String> phones = new ArrayList<>();
    private static final AtomicLong sequence = new AtomicLong(93000000);
    private final Instant initial = Instant.parse("2026-10-06T09:00:00Z");

    @BeforeEach void setup() {
        clock.set(initial);
        mvc = webAppContextSetup(context).build();
    }
    @AfterEach void cleanup() {
        for (String phone : phones) {
            for (UUID id : jdbc.query("select verification_grant_id from verification_grants where phone_number = ?", (row, n) -> row.getObject(1, UUID.class), phone))
                jdbc.update("delete from auth_operations where caller_scope_hash in (?, ?)", secrets.tokenHash("signup:" + id), secrets.tokenHash("new-browser-login:" + id));
            for (UUID id : jdbc.query("select browser_registration_id from browser_registrations where user_id in (select user_id from users where phone_number = ?)", (row, n) -> row.getObject(1, UUID.class), phone))
                jdbc.update("delete from auth_operations where caller_scope_hash = ?", secrets.tokenHash("registered-login:" + id));
            jdbc.update("delete from login_sessions where user_id in (select user_id from users where phone_number = ?)", phone);
            jdbc.update("delete from browser_registrations where user_id in (select user_id from users where phone_number = ?)", phone);
            jdbc.update("delete from users where phone_number = ?", phone);
            jdbc.update("delete from verification_grants where phone_number = ?", phone);
            jdbc.update("delete from sms_verifications where phone_number = ?", phone);
            jdbc.update("delete from sms_request_gates where phone_number = ?", phone);
            jdbc.update("delete from auth_operations where caller_scope_hash = ?", secrets.tokenHash("sms-request:" + phone));
        }
    }
    private Fixture account() {
        String phone = "+8210" + sequence.incrementAndGet(); phones.add(phone);
        var result = signup.signup(new AuthRequests.Signup(grant(phone, SmsPurpose.SIGNUP), "041527"), UUID.randomUUID());
        return new Fixture(phone, result.browserToken(), result.sessionToken());
    }
    private String grant(String phone, SmsPurpose purpose) {
        UUID id = UUID.fromString(sms.request(new AuthRequests.SmsRequest(phone, purpose), UUID.randomUUID()).requestId());
        return sms.verify(new AuthRequests.SmsVerification(id.toString(), sms.getMockCode(id).code())).verificationToken();
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
        var replacement = login.newBrowser(new AuthRequests.NewBrowserLogin(grant(old.phone(), SmsPurpose.LOGIN), "041527"), UUID.randomUUID());
        mvc.perform(get("/api/v1/auth/session").cookie(session(old.session())))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REPLACED"));
        mvc.perform(post("/api/v1/auth/logout").cookie(session(old.session()))).andExpect(status().isNoContent());
        mvc.perform(delete("/api/v1/auth/browser-registration").cookie(browser(old.browser()), session(old.session()))).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/auth/session").cookie(session(replacement.sessionToken())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
        assertTrue(service.registration(replacement.browserToken()).registered());
    }
    private record Fixture(String phone, String browser, String session) {
        @Override public String toString() { return "Fixture[redacted]"; }
    }
}
