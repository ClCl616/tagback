package com.tagback;

import com.tagback.controller.KakaoChallengeController;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.exception.*;
import com.tagback.service.*;
import com.tagback.domain.entity.LoginSession;
import com.tagback.domain.repository.LoginSessionRepository;
import jakarta.servlet.http.Cookie;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
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
class KakaoSignupIntegrationTest {
    @Autowired KakaoChallengeService challenges;
    @Autowired KakaoSignupService signup;
    @Autowired JdbcTemplate db;
    @Autowired WebApplicationContext context;
    @Autowired ObjectMapper json;
    @Autowired AuthSecrets secrets;
    @MockitoSpyBean LoginSessionRepository sessions;
    private final List<UUID> challengeIds = new ArrayList<>();
    private final Set<String> identities = new HashSet<>();

    @BeforeEach void resetSharedSkillWindow() {
        db.update("delete from kakao_auth_rate_limits where scope='skill-global'");
    }

    @AfterEach void cleanup() {
        for (String identity : identities) {
            db.update("delete from login_sessions where user_id in (select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?)", "test-bot", identity);
            db.update("delete from browser_registrations where user_id in (select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?)", "test-bot", identity);
            var users = db.queryForList("select user_id from kakao_bot_identities where bot_id=? and bot_user_key=?", Long.class, "test-bot", identity);
            db.update("delete from kakao_bot_identities where bot_id=? and bot_user_key=?", "test-bot", identity);
            for (Long user : users) db.update("delete from users where user_id=?", user);
        }
        for (UUID id : challengeIds) {
            db.update("delete from auth_operations where caller_scope_hash=?", secrets.keyedHash("kakao-signup-scope:" + id));
            db.update("delete from kakao_auth_challenges where challenge_id=?", id);
        }
    }

    private record Challenge(KakaoChallengeService.Issued issued, String proof) {}
    private Challenge issue(String purpose, String identity, boolean verify) {
        String proof = challenges.newProof();
        var issued = challenges.issue(purpose, proof, UUID.randomUUID().toString());
        challengeIds.add(issued.id());
        identities.add(identity);
        if (verify) assertTrue(challenges.verify(Map.of("bot", Map.of("id", "test-bot"), "userRequest", Map.of(
                "utterance", issued.code(), "user", Map.of("id", identity, "type", "botUserKey"))), UUID.randomUUID().toString()));
        return new Challenge(issued, proof);
    }
    private AuthRequests.KakaoSignup input(Challenge c) {
        return new AuthRequests.KakaoSignup(c.issued().id(), "041527", new AuthRequests.Profile("테스트", "학생"));
    }
    private void error(AuthErrorCode code, Runnable action) {
        assertEquals(code, assertThrows(AuthException.class, action::run).code());
    }

    @Test void signupHttpAndResponseLossRetryAreBoundToProof() throws Exception {
        var c = issue("SIGNUP", UUID.randomUUID().toString(), true);
        var request = input(c);
        var key = UUID.randomUUID();
        var mvc = webAppContextSetup(context).build();
        String body = json.writeValueAsString(request);
        var response = mvc.perform(post("/api/v1/auth/kakao/signup").contentType("application/json").content(body)
                .cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())).header("Idempotency-Key", key))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.user.maskedPhoneNumber").doesNotExist())
                .andReturn().getResponse();
        assertEquals(2, response.getHeaders("Set-Cookie").size());
        var retry = mvc.perform(post("/api/v1/auth/kakao/signup").contentType("application/json").content(body)
                .cookie(new Cookie(KakaoChallengeController.PROOF_COOKIE, c.proof())).header("Idempotency-Key", key))
                .andExpect(status().isCreated()).andReturn().getResponse();
        assertEquals(response.getContentAsString(), retry.getContentAsString());
        assertEquals(response.getHeaders("Set-Cookie").stream().map(s -> s.split(";", 2)[0]).toList(),
                retry.getHeaders("Set-Cookie").stream().map(s -> s.split(";", 2)[0]).toList());
        error(AuthErrorCode.VERIFICATION_INVALID, () -> signup.signup(request, challenges.newProof(), key));
        error(AuthErrorCode.VERIFICATION_CONSUMED, () -> signup.signup(request, c.proof(), UUID.randomUUID()));
        error(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT, () -> signup.signup(new AuthRequests.KakaoSignup(c.issued().id(), "920314", request.profile()), c.proof(), key));
        assertEquals("CONSUMED", challenges.status(c.issued().id(), c.proof()).status());
    }

    @Test void wrongPurposeUnverifiedCanceledExpiredAndDuplicateCannotRegister() {
        String identity = UUID.randomUUID().toString();
        var wrong = issue("LOGIN", identity, true);
        error(AuthErrorCode.VERIFICATION_PURPOSE_MISMATCH, () -> signup.signup(input(wrong), wrong.proof(), UUID.randomUUID()));
        var pending = issue("SIGNUP", identity, false);
        error(AuthErrorCode.VERIFICATION_INVALID, () -> signup.signup(input(pending), pending.proof(), UUID.randomUUID()));
        challenges.cancel(pending.issued().id(), pending.proof());
        error(AuthErrorCode.VERIFICATION_INVALID, () -> signup.signup(input(pending), pending.proof(), UUID.randomUUID()));
        var expired = issue("SIGNUP", identity, true);
        db.update("update kakao_auth_challenges set created_at=now()-interval '10 minutes', verified_at=now()-interval '9 minutes', expires_at=now()-interval '1 second' where challenge_id=?", expired.issued().id());
        error(AuthErrorCode.VERIFICATION_EXPIRED, () -> signup.signup(input(expired), expired.proof(), UUID.randomUUID()));
        var first = issue("SIGNUP", identity, true);
        signup.signup(input(first), first.proof(), UUID.randomUUID());
        var duplicate = issue("SIGNUP", identity, true);
        error(AuthErrorCode.KAKAO_IDENTITY_ALREADY_REGISTERED, () -> signup.signup(input(duplicate), duplicate.proof(), UUID.randomUUID()));
        assertEquals("VERIFIED", challenges.status(duplicate.issued().id(), duplicate.proof()).status());
    }

    @Test void concurrentChallengesForSameIdentityCreateOnlyOneAccount() throws Exception {
        String identity = UUID.randomUUID().toString();
        var a = issue("SIGNUP", identity, true);
        var b = issue("SIGNUP", identity, true);
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var fa = pool.submit(() -> attempt(a, start));
            var fb = pool.submit(() -> attempt(b, start));
            start.countDown();
            assertEquals(Set.of("OK", "KAKAO_IDENTITY_ALREADY_REGISTERED"), Set.of(fa.get(20, TimeUnit.SECONDS), fb.get(20, TimeUnit.SECONDS)));
        }
        assertEquals(1, db.queryForObject("select count(*) from kakao_bot_identities where bot_id=? and bot_user_key=?", Integer.class, "test-bot", identity));
        assertEquals(Set.of("CONSUMED", "VERIFIED"), Set.of(challenges.status(a.issued().id(), a.proof()).status(), challenges.status(b.issued().id(), b.proof()).status()));
    }

    @Test void persistenceFailureRollsBackAccountAndChallengeConsumption() {
        String identity = UUID.randomUUID().toString();
        var c = issue("SIGNUP", identity, true);
        doThrow(new IllegalStateException("test persistence failure")).when(sessions).saveAndFlush(any(LoginSession.class));
        assertThrows(IllegalStateException.class, () -> signup.signup(input(c), c.proof(), UUID.randomUUID()));
        assertEquals("VERIFIED", challenges.status(c.issued().id(), c.proof()).status());
        assertEquals(0, db.queryForObject("select count(*) from kakao_bot_identities where bot_id=? and bot_user_key=?", Integer.class, "test-bot", identity));
    }
    private String attempt(Challenge c, CountDownLatch start) throws InterruptedException {
        start.await();
        try { signup.signup(input(c), c.proof(), UUID.randomUUID()); return "OK"; }
        catch (AuthException e) { return e.code().name(); }
    }
}
