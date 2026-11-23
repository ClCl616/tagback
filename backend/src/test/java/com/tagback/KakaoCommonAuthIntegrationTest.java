package com.tagback;

import com.tagback.config.AuthCookies;
import com.tagback.domain.entity.BrowserRegistration;
import com.tagback.domain.entity.User;
import com.tagback.domain.repository.BrowserRegistrationRepository;
import com.tagback.domain.repository.UserRepository;
import com.tagback.service.AuthSecrets;
import com.tagback.service.PinService;
import com.tagback.service.SessionService;
import com.tagback.service.AuthSecrets;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;
import static org.junit.jupiter.api.Assertions.*;
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
class KakaoCommonAuthIntegrationTest {
    @Autowired WebApplicationContext context;
    @Autowired AuthSecrets secrets;
    @Autowired PinService pins;
    @Autowired UserRepository users;
    @Autowired BrowserRegistrationRepository browsers;

    @Test @Transactional
    void registeredLoginAndSessionWorkWithoutEnablingSmsMock() throws Exception {
        assertNotNull(context.getBean(SessionService.class));

        Instant now = Instant.now();
        var user = User.withoutPhone(pins.hash("041527"), now);
        user.setProfile("테스트", "학생");
        users.saveAndFlush(user);
        String browserToken = secrets.generateToken();
        browsers.saveAndFlush(new BrowserRegistration(user, secrets.tokenHash(browserToken), now.plus(30, ChronoUnit.DAYS), now));
        var mvc = webAppContextSetup(context).build();
        var login = mvc.perform(post("/api/v1/auth/login/registered")
                        .contentType("application/json").content("{\"pin\":\"041527\"}")
                        .cookie(new Cookie(AuthCookies.BROWSER_COOKIE, browserToken))
                        .header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isOk()).andReturn().getResponse();
        String sessionHeader = login.getHeaders("Set-Cookie").stream()
                .filter(value -> value.startsWith(AuthCookies.SESSION_COOKIE + "="))
                .findFirst().orElseThrow();
        String sessionToken = sessionHeader.substring(sessionHeader.indexOf('=') + 1, sessionHeader.indexOf(';'));
        mvc.perform(get("/api/v1/auth/session").cookie(new Cookie(AuthCookies.SESSION_COOKIE, sessionToken)))
                .andExpect(status().isOk());
    }
}
