package com.tagback;

import com.tagback.controller.MockSmsController;
import com.tagback.controller.SmsAuthController;
import com.tagback.domain.entity.User;
import com.tagback.domain.repository.SmsVerificationRepository;
import com.tagback.domain.repository.UserRepository;
import com.tagback.domain.repository.VerificationGrantRepository;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.SmsPurpose;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.sms.SmsAuthService;
import com.tagback.service.sms.SmsSecrets;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.http.MediaType;
import tools.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password="})
@Import(SmsMockApiIntegrationTest.TimeConfiguration.class)
class SmsMockApiIntegrationTest {
    @Autowired SmsAuthService service;
    @Autowired SmsAuthController controller;
    @Autowired MockSmsController mockController;
    @Autowired SmsVerificationRepository requests;
    @Autowired UserRepository users;
    @Autowired VerificationGrantRepository grants;
    @Autowired SmsSecrets secrets;
    @Autowired MutableClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    private MockMvc mvc;
    private final List<String> phones = new ArrayList<>();
    private static final AtomicLong sequence = new AtomicLong(90000000);
    private final Instant initial = Instant.parse("2026-10-06T09:00:00Z");

    @BeforeEach void setup() {
        clock.set(initial);
        mvc = standaloneSetup(controller, mockController).setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @AfterEach void cleanup() {
        for (String phone : phones) {
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

    private UUID request(String phone, SmsPurpose purpose) {
        return UUID.fromString(service.request(new AuthRequests.SmsRequest(phone, purpose), UUID.randomUUID()).requestId());
    }

    private void expectError(AuthErrorCode code, Runnable action) {
        assertEquals(code, assertThrows(AuthException.class, action::run).code());
    }

    @Test void registeredNumberIsRejectedBeforeSignupSmsButCanResetPin() throws Exception {
        String phone = phone();
        users.saveAndFlush(new User(phone, "unused-pin-hash", initial));
        String localPhone = "0" + phone.substring(3);
        mvc.perform(post("/api/v1/auth/sms/requests")
                        .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AuthRequests.SmsRequest(localPhone, SmsPurpose.SIGNUP))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("PHONE_NUMBER_ALREADY_REGISTERED"));
        assertEquals(0, requests.countSentSince(phone, initial.minusSeconds(1)));
        assertEquals(0, jdbc.queryForObject("select count(*) from sms_request_gates where phone_number = ?", Integer.class, phone));
        assertNotNull(request(phone, SmsPurpose.PIN_RESET));
    }

    @Test void apiReturnsUtcMetadataAndIssuesOnlyHashedGrantAfterVerification() throws Exception {
        String phone = phone();
        String body = json.writeValueAsString(new AuthRequests.SmsRequest(phone, SmsPurpose.SIGNUP));
        String response = mvc.perform(post("/api/v1/auth/sms/requests")
                        .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.expiresAt").value("2026-10-06T09:05:00Z"))
                .andExpect(jsonPath("$.resendAvailableAt").value("2026-10-06T09:01:00Z"))
                .andExpect(jsonPath("$.code").doesNotExist()).andReturn().getResponse().getContentAsString();
        UUID id = UUID.fromString(json.readTree(response).get("requestId").asString());
        String code = service.getMockCode(id).code();
        assertTrue(code.matches("[0-9]{6}"));
        assertNotEquals(code, requests.findById(id).orElseThrow().getCodeHash());
        mvc.perform(get("/api/v1/dev/sms/requests/" + id)).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(jsonPath("$.code").value(code));
        String verified = mvc.perform(post("/api/v1/auth/sms/verifications").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AuthRequests.SmsVerification(id.toString(), code))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.purpose").value("SIGNUP"))
                .andExpect(jsonPath("$.expiresAt").value("2026-10-06T09:10:00Z"))
                .andReturn().getResponse().getContentAsString();
        String token = json.readTree(verified).get("verificationToken").asString();
        var grant = grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow();
        assertEquals(phone, grant.getPhoneNumber());
        assertNull(grant.getConsumedAt());
        expectError(AuthErrorCode.SMS_ALREADY_VERIFIED,
                () -> service.verify(new AuthRequests.SmsVerification(id.toString(), code)));
    }

    @Test void retryUsesSameRequestWithoutAdditionalSmsAndRejectsDifferentPurpose() {
        String phone = phone();
        UUID key = UUID.randomUUID();
        var first = service.request(new AuthRequests.SmsRequest(phone, SmsPurpose.SIGNUP), key);
        assertEquals(first, service.request(new AuthRequests.SmsRequest(phone, SmsPurpose.SIGNUP), key));
        assertEquals(1, requests.countSentSince(phone, initial.minusSeconds(1)));
        expectError(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT,
                () -> service.request(new AuthRequests.SmsRequest(phone, SmsPurpose.LOGIN), key));
        UUID id = UUID.fromString(first.requestId());
        assertEquals(SmsPurpose.SIGNUP,
                service.verify(new AuthRequests.SmsVerification(id.toString(), service.getMockCode(id).code())).purpose());
    }

    @Test void resendIsSharedAcrossPurposesAndInvalidatesOldCodeAtBoundary() {
        String phone = phone();
        UUID old = request(phone, SmsPurpose.LOGIN);
        String code = service.getMockCode(old).code();
        var wait = assertThrows(AuthException.class, () -> request(phone, SmsPurpose.SIGNUP));
        assertEquals(AuthErrorCode.SMS_RESEND_WAIT, wait.code());
        assertEquals(initial.plusSeconds(60), wait.retryAt());
        assertNull(requests.findById(old).orElseThrow().getInvalidatedAt());
        clock.advance(Duration.ofSeconds(60));
        UUID replacement = request(phone, SmsPurpose.SIGNUP);
        expectError(AuthErrorCode.SMS_REQUEST_INVALIDATED,
                () -> service.verify(new AuthRequests.SmsVerification(old.toString(), code)));
        assertEquals(initial.plusSeconds(60), requests.findById(old).orElseThrow().getInvalidatedAt());
        assertNotEquals(old, replacement);

        String replacementCode = service.getMockCode(replacement).code();
        clock.advance(Duration.ofSeconds(60));
        UUID newest = request(phone, SmsPurpose.SIGNUP);
        expectError(AuthErrorCode.SMS_REQUEST_INVALIDATED,
                () -> service.verify(new AuthRequests.SmsVerification(replacement.toString(), replacementCode)));
        assertNotEquals(replacement, newest);
        assertEquals(SmsPurpose.SIGNUP,
                service.verify(new AuthRequests.SmsVerification(newest.toString(), service.getMockCode(newest).code())).purpose());
    }

    @Test void newSmsAlsoInvalidatesUnusedProofFromAnotherPurpose() {
        String phone = phone();
        UUID old = request(phone, SmsPurpose.LOGIN);
        String token = service.verify(new AuthRequests.SmsVerification(old.toString(), service.getMockCode(old).code()))
                .verificationToken();
        assertNull(grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow().getConsumedAt());

        clock.advance(Duration.ofSeconds(60));
        UUID replacement = request(phone, SmsPurpose.SIGNUP);
        assertEquals(initial.plusSeconds(60),
                grants.findByTokenHash(secrets.tokenHash(token)).orElseThrow().getConsumedAt());
        assertNull(requests.findById(old).orElseThrow().getInvalidatedAt());
        assertEquals(SmsPurpose.SIGNUP,
                service.verify(new AuthRequests.SmsVerification(replacement.toString(), service.getMockCode(replacement).code())).purpose());
    }

    @Test void fifthWrongCodeCommitsCounterAndBlocksCorrectCode() {
        UUID id = request(phone(), SmsPurpose.LOGIN);
        String correct = service.getMockCode(id).code();
        String wrong = correct.equals("000000") ? "000001" : "000000";
        for (int attempt = 1; attempt <= 5; attempt++) {
            expectError(attempt == 5 ? AuthErrorCode.SMS_ATTEMPTS_EXCEEDED : AuthErrorCode.SMS_CODE_MISMATCH,
                    () -> service.verify(new AuthRequests.SmsVerification(id.toString(), wrong)));
            assertEquals(attempt, requests.findById(id).orElseThrow().getFailedCount());
        }
        expectError(AuthErrorCode.SMS_ATTEMPTS_EXCEEDED,
                () -> service.verify(new AuthRequests.SmsVerification(id.toString(), correct)));
        assertEquals(5, requests.findById(id).orElseThrow().getFailedCount());
    }

    @Test void codeExpiresAtFiveMinuteBoundary() {
        UUID id = request(phone(), SmsPurpose.LOGIN);
        String code = service.getMockCode(id).code();
        clock.advance(Duration.ofMinutes(5));
        expectError(AuthErrorCode.SMS_CODE_EXPIRED,
                () -> service.verify(new AuthRequests.SmsVerification(id.toString(), code)));
    }

    @Test void dailyLimitIncludesAllPurposesAndReopensAtOldestSendExpiry() {
        String phone = phone();
        for (int i = 0; i < 10; i++) {
            request(phone, i % 2 == 0 ? SmsPurpose.SIGNUP : SmsPurpose.LOGIN);
            clock.advance(Duration.ofMinutes(1));
        }
        var limit = assertThrows(AuthException.class, () -> request(phone, SmsPurpose.LOGIN));
        assertEquals(AuthErrorCode.SMS_REQUEST_LIMIT_EXCEEDED, limit.code());
        assertEquals(initial.plus(Duration.ofHours(24)), limit.retryAt());
        assertEquals(10, requests.countSentSince(phone, initial.minusSeconds(1)));
        clock.set(limit.retryAt());
        assertNotNull(request(phone, SmsPurpose.LOGIN));
    }

    @Test void concurrentSameKeyRequestsSendOnlyOnce() throws Exception {
        String phone = phone();
        UUID key = UUID.randomUUID();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var ready = new CountDownLatch(2);
            var start = new CountDownLatch(1);
            Callable<String> task = () -> {
                ready.countDown();
                assertTrue(start.await(5, TimeUnit.SECONDS));
                return service.request(new AuthRequests.SmsRequest(phone, SmsPurpose.LOGIN), key).requestId();
            };
            var first = executor.submit(task);
            var second = executor.submit(task);
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            assertEquals(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            assertEquals(1, requests.countSentSince(phone, initial.minusSeconds(1)));
        }
    }

    @Test void concurrentVerificationProducesOneGrant() throws Exception {
        UUID id = request(phone(), SmsPurpose.LOGIN);
        String code = service.getMockCode(id).code();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var ready = new CountDownLatch(2);
            var start = new CountDownLatch(1);
            Callable<Boolean> task = () -> {
                ready.countDown();
                assertTrue(start.await(5, TimeUnit.SECONDS));
                try {
                    service.verify(new AuthRequests.SmsVerification(id.toString(), code));
                    return true;
                } catch (AuthException error) {
                    assertEquals(AuthErrorCode.SMS_ALREADY_VERIFIED, error.code());
                    return false;
                }
            };
            var first = executor.submit(task);
            var second = executor.submit(task);
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            assertNotEquals(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            assertEquals(1, jdbc.queryForObject("select count(*) from verification_grants where sms_verification_id = ?", Long.class, id));
        }
    }

    @Test void malformedRequestsReturnCommonErrorsWithoutSpendingAttempts() throws Exception {
        String phone = phone();
        mvc.perform(post("/api/v1/auth/sms/requests").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AuthRequests.SmsRequest(phone, SmsPurpose.LOGIN))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        UUID id = request(phone, SmsPurpose.LOGIN);
        mvc.perform(post("/api/v1/auth/sms/verifications").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AuthRequests.SmsVerification(id.toString(), "12345"))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        assertEquals(0, requests.findById(id).orElseThrow().getFailedCount());
    }

    @Test void pinRecoverySmsIsIssuedOnlyForRegisteredPhone() {
        String registered = phone();
        String unknown = phone();
        users.saveAndFlush(new User(registered, "unused-pin-hash", initial));

        expectError(AuthErrorCode.ACCOUNT_NOT_FOUND, () -> request(unknown, SmsPurpose.PIN_RESET));
        assertEquals(0, requests.countSentSince(unknown, initial.minusSeconds(1)));

        UUID id = request(registered, SmsPurpose.PIN_RESET);
        assertEquals(registered, requests.findById(id).orElseThrow().getPhoneNumber());
        var verified = service.verify(new AuthRequests.SmsVerification(id.toString(), service.getMockCode(id).code()));
        assertEquals(SmsPurpose.PIN_RESET, verified.purpose());
        assertEquals(1, requests.countSentSince(registered, initial.minusSeconds(1)));

        expectError(AuthErrorCode.REAUTHENTICATION_REQUIRED, () -> request(registered, SmsPurpose.PHONE_CHANGE));
        assertEquals(1, requests.countSentSince(registered, initial.minusSeconds(1)));
    }

    @TestConfiguration
    static class TimeConfiguration {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
    }
    static class MutableClock extends Clock {
        private volatile Instant time = Instant.parse("2026-10-06T09:00:00Z");
        void set(Instant time) { this.time = time; }
        void advance(Duration duration) { time = time.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(time, zone); }
        @Override public Instant instant() { return time; }
    }
}
