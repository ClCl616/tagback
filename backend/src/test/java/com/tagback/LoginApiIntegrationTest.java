package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.controller.LoginController;
import com.tagback.controller.PinResetController;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.*;
import com.tagback.exception.*;
import com.tagback.service.LoginService;
import com.tagback.service.PinResetService;
import com.tagback.service.PinService;
import com.tagback.service.SignupService;
import com.tagback.service.sms.SmsAuthService;
import com.tagback.service.sms.SmsSecrets;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password="})
@Import(SmsMockApiIntegrationTest.TimeConfiguration.class)
class LoginApiIntegrationTest {
    @Autowired LoginService login;
    @Autowired PinResetService pinReset;
    @Autowired PinResetController pinResetController;
    @Autowired PinService pins;
    @Autowired LoginController controller;
    @Autowired SignupService signup;
    @Autowired SmsAuthService sms;
    @Autowired SmsSecrets secrets;
    @Autowired UserRepository users;
    @Autowired VerificationGrantRepository grants;
    @MockitoSpyBean LoginSessionRepository sessions;
    @Autowired SmsMockApiIntegrationTest.MutableClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired PlatformTransactionManager transactionManager;
    private MockMvc mvc;
    private final List<String> phones = new ArrayList<>();
    private static final AtomicLong sequence = new AtomicLong(92000000);
    private final Instant initial = Instant.parse("2026-10-06T09:00:00Z");

    @BeforeEach void setup() {
        clock.set(initial);
        mvc = standaloneSetup(controller).setControllerAdvice(new ApiExceptionHandler()).build();
    }
    @AfterEach void cleanup() {
        for (String phone : phones) {
            for (Long id : jdbc.query("select user_id from users where phone_number = ?", (row, n) -> row.getLong(1), phone))
                jdbc.update("delete from auth_operations where caller_scope_hash = ?", secrets.tokenHash("phone-login:" + id));
            for (UUID id : jdbc.query("select verification_grant_id from verification_grants where phone_number = ?", (row, n) -> row.getObject(1, UUID.class), phone)) {
                jdbc.update("delete from auth_operations where caller_scope_hash in (?, ?)",
                        secrets.tokenHash("signup:" + id), secrets.tokenHash("new-browser-login:" + id));
                jdbc.update("delete from auth_operations where caller_scope_hash = ?", secrets.tokenHash("pin-reset:" + id));
            }
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
        String phone = "+8210" + sequence.incrementAndGet();
        phones.add(phone);
        var result = signup.signup(new AuthRequests.Signup(grant(phone, SmsPurpose.SIGNUP), "041527", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID());
        return new Fixture(phone, Long.parseLong(result.response().user().userId()), result.browserToken(), result.sessionToken());
    }
    private String grant(String phone, SmsPurpose purpose) {
        UUID id = UUID.fromString(sms.request(new AuthRequests.SmsRequest(phone, purpose), UUID.randomUUID()).requestId());
        return sms.verify(new AuthRequests.SmsVerification(id.toString(), sms.getMockCode(id).code())).verificationToken();
    }
    private void failures(Fixture fixture, int count) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> users.updatePinFailureState(fixture.userId(), count, null));
    }
    private AuthException error(AuthErrorCode code, Runnable action) {
        var error = assertThrows(AuthException.class, action::run);
        assertEquals(code, error.code());
        return error;
    }

    @Test void phonePinLoginWorksWithoutSmsAndReplacesPreviousBrowser() throws Exception {
        var account = account();
        error(AuthErrorCode.PIN_MISMATCH, () -> login.phone(new AuthRequests.PhoneLogin(account.phone(), "041528"), UUID.randomUUID()));
        assertEquals(1, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        UUID key = UUID.randomUUID();
        mvc.perform(post("/api/v1/auth/login/phone").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AuthRequests.PhoneLogin(account.phone(), "041527"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.name").value("테스트"))
                .andExpect(jsonPath("$.user.occupation").value("학생"))
                .andExpect(header().exists("Set-Cookie"));
        assertEquals(SessionRevokedReason.SESSION_REPLACED,
                sessions.findBySessionTokenHash(secrets.tokenHash(account.sessionToken())).orElseThrow().getRevokedReason());
        assertTrue(login.phone(new AuthRequests.PhoneLogin(account.phone(), "041527"), key).previousBrowserRevoked());
        assertEquals(1, jdbc.queryForObject("select count(*) from browser_registrations where user_id = ? and revoked_at is null", Long.class, account.userId()));
    }

    @Test void verifiedRecoverySmsResetsPinWithoutApprovalAndRevokesAuthentication() throws Exception {
        var account = account();
        failures(account, 20);
        clock.advance(Duration.ofMinutes(1));
        UUID requestId = UUID.fromString(sms.request(new AuthRequests.SmsRequest(account.phone(), SmsPurpose.PIN_RESET),
                UUID.randomUUID()).requestId());
        error(AuthErrorCode.VERIFICATION_INVALID,
                () -> pinReset.reset(new AuthRequests.PinReset(requestId.toString(), "246802"), UUID.randomUUID()));
        String token = sms.verify(new AuthRequests.SmsVerification(requestId.toString(), sms.getMockCode(requestId).code()))
                .verificationToken();
        UUID key = UUID.randomUUID();
        var input = new AuthRequests.PinReset(token, "246802");
        assertEquals(new AuthResponses.PinResetResult(true), pinReset.reset(input, key));
        assertEquals(new AuthResponses.PinResetResult(true), pinReset.reset(input, key));
        assertTrue(pins.matches("246802", users.findById(account.userId()).orElseThrow().getPinHash()));
        assertFalse(pins.matches("041527", users.findById(account.userId()).orElseThrow().getPinHash()));
        assertEquals(0, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.sessionToken()), clock.instant()).isEmpty());
        error(AuthErrorCode.VERIFICATION_CONSUMED, () -> pinReset.reset(input, UUID.randomUUID()));
        error(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT,
                () -> pinReset.reset(new AuthRequests.PinReset(token, "246803"), key));

        var response = mvc.perform(post("/api/v1/auth/login/registered")
                        .cookie(new Cookie(AuthCookies.BROWSER_COOKIE, account.browserToken()))
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AuthRequests.RegisteredLogin("041527"))))
                .andExpect(status().isUnauthorized()).andReturn().getResponse();
        assertTrue(response.getContentAsString().contains("BROWSER_REGISTRATION_INVALID"));
    }

    @Test void pinResetRejectsOtherSmsPurposeAndClearsCookiesOnSuccess() throws Exception {
        var account = account();
        clock.advance(Duration.ofMinutes(1));
        String loginToken = grant(account.phone(), SmsPurpose.LOGIN);
        error(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH,
                () -> pinReset.reset(new AuthRequests.PinReset(loginToken, "246802"), UUID.randomUUID()));
        clock.advance(Duration.ofMinutes(1));
        String resetToken = grant(account.phone(), SmsPurpose.PIN_RESET);
        var resetMvc = standaloneSetup(pinResetController).setControllerAdvice(new ApiExceptionHandler()).build();
        resetMvc.perform(post("/api/v1/auth/pin/reset")
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AuthRequests.PinReset(resetToken, "246802"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.completed").value(true))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("Set-Cookie"));
    }

    @Test void registeredLoginPersistsWaitDeduplicatesFailureAndResetsOnSuccess() throws Exception {
        var account = account();
        failures(account, 4);
        UUID key = UUID.randomUUID();
        var wait = error(AuthErrorCode.PIN_RETRY_WAIT, () -> login.registered(new AuthRequests.RegisteredLogin("041528"), account.browserToken(), key));
        assertEquals(initial.plusSeconds(30), wait.retryAt());
        error(AuthErrorCode.PIN_RETRY_WAIT, () -> login.registered(new AuthRequests.RegisteredLogin("041528"), account.browserToken(), key));
        error(AuthErrorCode.PIN_RETRY_WAIT, () -> login.registered(new AuthRequests.RegisteredLogin("041527"), account.browserToken(), UUID.randomUUID()));
        assertEquals(5, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.sessionToken()), clock.instant()).isPresent());
        clock.advance(Duration.ofSeconds(30));
        UUID successKey = UUID.randomUUID();
        mvc.perform(post("/api/v1/auth/login/registered").cookie(new Cookie(AuthCookies.BROWSER_COOKIE, account.browserToken()))
                        .header("Idempotency-Key", successKey).contentType(MediaType.APPLICATION_JSON).content("{\"pin\":\"041527\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.userId").value(account.userId().toString()))
                .andExpect(header().exists("Set-Cookie"));
        var replay = login.registered(new AuthRequests.RegisteredLogin("041527"), account.browserToken(), successKey);
        assertEquals(initial.plusSeconds(30).plus(Duration.ofDays(30)), replay.response().browserRegistrationExpiresAt());
        assertEquals(0, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        assertNull(users.findById(account.userId()).orElseThrow().getPinLockedUntil());
        assertEquals(1, jdbc.queryForObject("select count(*) from login_sessions where user_id = ? and revoked_at is null", Long.class, account.userId()));
    }

    @Test void remainingThresholdsAndRecoveryBlockAreEnforced() {
        var account = account();
        int[] before = {9, 14, 19};
        long[] seconds = {60, 300, 0};
        for (int i = 0; i < before.length; i++) {
            failures(account, before[i]);
            AuthErrorCode code = i == 2 ? AuthErrorCode.PIN_LOGIN_BLOCKED : AuthErrorCode.PIN_RETRY_WAIT;
            var result = error(code, () -> login.registered(new AuthRequests.RegisteredLogin("041528"), account.browserToken(), UUID.randomUUID()));
            assertEquals(before[i] + 1, users.findById(account.userId()).orElseThrow().getPinFailedCount());
            if (i != 2) assertEquals(clock.instant().plusSeconds(seconds[i]), result.retryAt());
        }
        error(AuthErrorCode.PIN_LOGIN_BLOCKED, () -> login.registered(new AuthRequests.RegisteredLogin("041527"), account.browserToken(), UUID.randomUUID()));
        assertEquals(20, users.findById(account.userId()).orElseThrow().getPinFailedCount());
    }

    @Test void newBrowserFailurePreservesOldAccessAndSuccessRevokesIt() throws Exception {
        var account = account();
        clock.advance(Duration.ofMinutes(1));
        String token = grant(account.phone(), SmsPurpose.LOGIN);
        error(AuthErrorCode.PIN_MISMATCH, () -> login.newBrowser(new AuthRequests.NewBrowserLogin(token, "041528"), UUID.randomUUID()));
        assertEquals(1, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        assertNull(grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow().getConsumedAt());
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.sessionToken()), clock.instant()).isPresent());
        UUID key = UUID.randomUUID();
        mvc.perform(post("/api/v1/auth/login/new-browser").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(new AuthRequests.NewBrowserLogin(token, "041527"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.previousBrowserRevoked").value(true))
                .andExpect(header().exists("Set-Cookie"));
        assertEquals(SessionRevokedReason.SESSION_REPLACED, sessions.findBySessionTokenHash(secrets.tokenHash(account.sessionToken())).orElseThrow().getRevokedReason());
        assertNotNull(grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow().getConsumedAt());
        assertEquals(0, users.findById(account.userId()).orElseThrow().getPinFailedCount());
        error(AuthErrorCode.BROWSER_REGISTRATION_INVALID, () -> login.registered(new AuthRequests.RegisteredLogin("041527"), account.browserToken(), UUID.randomUUID()));
        assertNotNull(login.newBrowser(new AuthRequests.NewBrowserLogin(token, "041527"), key));
        assertEquals(1, jdbc.queryForObject("select count(*) from browser_registrations where user_id = ? and revoked_at is null", Long.class, account.userId()));
    }

    @Test void successStorageFailureRollsBackRevocationConsumptionAndFailureReset() {
        var account = account();
        clock.advance(Duration.ofMinutes(1));
        String token = grant(account.phone(), SmsPurpose.LOGIN);
        failures(account, 3);
        doThrow(new IllegalStateException("test persistence failure")).when(sessions).saveAndFlush(any(LoginSession.class));
        assertThrows(IllegalStateException.class, () -> login.newBrowser(new AuthRequests.NewBrowserLogin(token, "041527"), UUID.randomUUID()));
        assertTrue(sessions.findValidByTokenHash(secrets.tokenHash(account.sessionToken()), clock.instant()).isPresent());
        assertNull(grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow().getConsumedAt());
        assertEquals(3, users.findById(account.userId()).orElseThrow().getPinFailedCount());
    }
    private record Fixture(String phone, Long userId, String browserToken, String sessionToken) {
        @Override public String toString() { return "Fixture[redacted]"; }
    }
}
