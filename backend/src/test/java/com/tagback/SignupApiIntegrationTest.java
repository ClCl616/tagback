package com.tagback;

import com.tagback.controller.SignupController;
import com.tagback.domain.entity.LoginSession;
import com.tagback.domain.entity.User;
import com.tagback.domain.repository.*;
import com.tagback.dto.auth.*;
import com.tagback.exception.*;
import com.tagback.service.PinService;
import com.tagback.service.SignupService;
import com.tagback.service.sms.SmsAuthService;
import com.tagback.service.sms.SmsSecrets;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
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
class SignupApiIntegrationTest {
    @Autowired SignupService signup;
    @Autowired SignupController controller;
    @Autowired SmsAuthService sms;
    @Autowired SmsSecrets secrets;
    @Autowired PinService pins;
    @Autowired UserRepository users;
    @Autowired VerificationGrantRepository grants;
    @MockitoSpyBean LoginSessionRepository sessions;
    @Autowired SmsMockApiIntegrationTest.MutableClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    private MockMvc mvc;
    private final List<String> phones = new ArrayList<>();
    private static final AtomicLong sequence = new AtomicLong(91000000);
    private final Instant initial = Instant.parse("2026-10-06T09:00:00Z");

    @BeforeEach void setup() {
        clock.set(initial);
        mvc = standaloneSetup(controller).setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @AfterEach void cleanup() {
        for (String phone : phones) {
            for (UUID id : jdbc.query("select verification_grant_id from verification_grants where phone_number = ?",
                    (row, number) -> row.getObject(1, UUID.class), phone)) {
                jdbc.update("delete from auth_operations where caller_scope_hash = ?", secrets.tokenHash("signup:" + id));
            }
            jdbc.update("delete from login_sessions where user_id in (select user_id from users where phone_number = ?)", phone);
            jdbc.update("delete from browser_registrations where user_id in (select user_id from users where phone_number = ?)", phone);
            jdbc.update("delete from users where phone_number = ?", phone);
            jdbc.update("delete from verification_grants where phone_number = ?", phone);
            jdbc.update("delete from sms_verifications where phone_number = ?", phone);
            jdbc.update("delete from sms_request_gates where phone_number = ?", phone);
            jdbc.update("delete from auth_operations where caller_scope_hash = ?", secrets.tokenHash("sms-request:" + phone));
        }
    }

    private String phone() {
        String phone = "+8210" + sequence.incrementAndGet();
        phones.add(phone);
        return phone;
    }
    private String grant(String phone, SmsPurpose purpose) {
        UUID id = UUID.fromString(sms.request(new AuthRequests.SmsRequest(phone, purpose), UUID.randomUUID()).requestId());
        return sms.verify(new AuthRequests.SmsVerification(id.toString(), sms.getMockCode(id).code())).verificationToken();
    }
    private void error(AuthErrorCode code, Runnable action) {
        assertEquals(code, assertThrows(AuthException.class, action::run).code());
    }

    @Test void signupCreatesUserAndSecureCookiesAndRetriesWithoutDuplicates() throws Exception {
        String phone = phone();
        String token = grant(phone, SmsPurpose.SIGNUP);
        UUID key = UUID.randomUUID();
        String body = json.writeValueAsString(new AuthRequests.Signup(token, "041527", new AuthRequests.Profile("테스트", "학생")));
        // Cross-origin login CSRF must be rejected before consuming the proof.
        mvc.perform(post("/api/v1/auth/signup").header("Origin", "https://untrusted.example")
                        .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        var response = mvc.perform(post("/api/v1/auth/signup").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.user.role").value("USER"))
                .andExpect(jsonPath("$.sessionExpiresAt").value("2026-10-06T09:30:00Z"))
                .andExpect(jsonPath("$.browserRegistrationExpiresAt").value("2026-11-05T09:00:00Z"))
                .andReturn().getResponse();
        var cookies = response.getHeaders("Set-Cookie");
        assertEquals(2, cookies.size());
        for (String cookie : cookies) {
            assertTrue(cookie.contains("Secure")); assertTrue(cookie.contains("HttpOnly"));
            assertTrue(cookie.contains("SameSite=Lax")); assertTrue(cookie.contains("Path=/"));
        }
        var user = users.findByPhoneNumber(phone).orElseThrow();
        assertEquals("테스트", user.getName());
        assertEquals("학생", user.getOccupation());
        assertTrue(pins.matches("041527", user.getPinHash()));
        assertNotNull(grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow().getConsumedAt());
        var retry = mvc.perform(post("/api/v1/auth/signup").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isCreated()).andReturn().getResponse();
        // Spring computes the Expires header from wall time; compare cookie identities instead.
        assertEquals(cookies.stream().map(value -> value.split(";", 2)[0]).toList(),
                retry.getHeaders("Set-Cookie").stream().map(value -> value.split(";", 2)[0]).toList());
        assertEquals(1, jdbc.queryForObject("select count(*) from login_sessions where user_id = ?", Long.class, user.getId()));
        error(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT, () -> signup.signup(new AuthRequests.Signup(token, "920314", new AuthRequests.Profile("테스트", "학생")), key));
        error(AuthErrorCode.VERIFICATION_CONSUMED, () -> signup.signup(new AuthRequests.Signup(token, "041527", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID()));
    }

    @Test void invalidPinWrongPurposeExpiryAndDuplicateDoNotConsumeProof() {
        String firstPhone = phone();
        String first = grant(firstPhone, SmsPurpose.SIGNUP);
        error(AuthErrorCode.PIN_POLICY_VIOLATION, () -> signup.signup(new AuthRequests.Signup(first, "789012", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID()));
        assertNull(grants.findByTokenHash(secrets.tokenHash(first)).orElseThrow().getConsumedAt());
        String login = grant(phone(), SmsPurpose.LOGIN);
        error(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH, () -> signup.signup(new AuthRequests.Signup(login, "041527", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID()));
        users.saveAndFlush(new User(firstPhone, pins.hash("920314"), initial));
        error(AuthErrorCode.PHONE_NUMBER_ALREADY_REGISTERED, () -> signup.signup(new AuthRequests.Signup(first, "041527", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID()));
        assertNull(grants.findByTokenHash(secrets.tokenHash(first)).orElseThrow().getConsumedAt());
        clock.advance(Duration.ofMinutes(10));
        error(AuthErrorCode.VERIFICATION_EXPIRED, () -> signup.signup(new AuthRequests.Signup(first, "041527", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID()));
        error(AuthErrorCode.VERIFICATION_INVALID, () -> signup.signup(new AuthRequests.Signup("unknown-token", "041527", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID()));
    }

    @Test void sessionSaveFailureRollsBackAccountRegistrationAndProofConsumption() {
        String phone = phone();
        String token = grant(phone, SmsPurpose.SIGNUP);
        doThrow(new IllegalStateException("test persistence failure")).when(sessions).saveAndFlush(any(LoginSession.class));
        assertThrows(IllegalStateException.class, () -> signup.signup(new AuthRequests.Signup(token, "041527", new AuthRequests.Profile("테스트", "학생")), UUID.randomUUID()));
        assertFalse(users.existsByPhoneNumber(phone));
        assertNull(grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow().getConsumedAt());
        assertEquals(0, jdbc.queryForObject("select count(*) from browser_registrations", Long.class));
    }
}
