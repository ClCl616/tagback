package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.SessionController;
import com.tagback.domain.entity.UserRole;
import com.tagback.exception.*;
import com.tagback.service.SessionService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.*;
import java.time.Clock;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

@WebMvcTest(SessionAuthenticationTest.TestController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, SessionAuthenticationTest.TestController.class})
class SessionAuthenticationTest {
    @Autowired MockMvc mvc;
    @MockitoBean SessionService sessions;

    @RestController
    static class TestController {
        @GetMapping("/api/v1/test/protected")
        public AuthenticatedUser protectedApi(@RequestAttribute(AuthenticatedUser.ATTRIBUTE) AuthenticatedUser user) {
            return user;
        }

        @PublicApi
        @PostMapping("/api/v1/test/public")
        public String publicApi() { return "public"; }

        @GetMapping("/test/outside-api")
        public String outsideApi() { return "outside"; }
    }

    @Test void missingSessionIsRejectedBeforeControllerRuns() throws Exception {
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        mvc.perform(get("/api/v1/test/protected"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
    }

    @Test void identityComesFromSessionInsteadOfClientFields() throws Exception {
        when(sessions.authenticate("test-session")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));
        mvc.perform(get("/api/v1/test/protected").cookie(new Cookie(AuthCookies.SESSION_COOKIE, "test-session"))
                        .param("userId", "999").param("role", "ADMIN").header("X-User-Id", "999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(7))
                .andExpect(jsonPath("$.role").value("USER"));
        verify(sessions).authenticate("test-session");
        verifyNoMoreInteractions(sessions);
    }

    @Test void expiredAndRevokedSessionErrorsArePreserved() throws Exception {
        for (var code : new AuthErrorCode[]{AuthErrorCode.SESSION_EXPIRED, AuthErrorCode.SESSION_REPLACED,
                AuthErrorCode.SESSION_REQUIRED}) {
            doThrow(new AuthException(code)).when(sessions).authenticate("invalid-session");
            mvc.perform(get("/api/v1/test/protected").cookie(new Cookie(AuthCookies.SESSION_COOKIE, "invalid-session")))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value(code.name()));
        }
    }

    @Test void publicApiDoesNotValidateEvenStaleSession() throws Exception {
        mvc.perform(post("/api/v1/test/public").cookie(new Cookie(AuthCookies.SESSION_COOKIE, "expired-session")))
                .andExpect(status().isOk()).andExpect(content().string("public"));
        verifyNoInteractions(sessions);
    }

    @Test void duplicateSessionCookiesAreRejected() throws Exception {
        mvc.perform(get("/api/v1/test/protected").cookie(new Cookie(AuthCookies.SESSION_COOKIE, "one"),
                        new Cookie(AuthCookies.SESSION_COOKIE, "two")))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        verifyNoInteractions(sessions);
    }

    @Test void nonApiRoutesAreUnaffected() throws Exception {
        mvc.perform(get("/test/outside-api")).andExpect(status().isOk());
        verifyNoInteractions(sessions);
    }

    @Test void protectedApiFailsClosedWhenAuthenticationServiceIsUnavailable() throws Exception {
        var interceptor = new SessionAuthenticationInterceptor(new StaticListableBeanFactory().getBeanProvider(SessionService.class));
        standaloneSetup(new TestController()).addInterceptors(interceptor)
                .setControllerAdvice(new ApiExceptionHandler()).build()
                .perform(get("/api/v1/test/protected"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
    }

    @Test void actualPublicSessionCleanupEndpointsRemainAvailableWithStaleCookies() throws Exception {
        var beans = new StaticListableBeanFactory();
        beans.addBean("sessions", sessions);
        var controller = new SessionController(sessions, new AuthCookies(Clock.systemUTC()), new AuthOriginGuard(""));
        var cleanup = standaloneSetup(controller)
                .addInterceptors(new SessionAuthenticationInterceptor(beans.getBeanProvider(SessionService.class)))
                .setControllerAdvice(new ApiExceptionHandler()).build();
        cleanup.perform(post("/api/v1/auth/logout").cookie(new Cookie(AuthCookies.SESSION_COOKIE, "stale")))
                .andExpect(status().isNoContent()).andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
        cleanup.perform(delete("/api/v1/auth/browser-registration").cookie(new Cookie(AuthCookies.SESSION_COOKIE, "stale")))
                .andExpect(status().isNoContent());
        verify(sessions).logout("stale");
        verify(sessions).unregister(null, "stale");
        verifyNoMoreInteractions(sessions);
        cleanup.perform(post("/api/v1/auth/logout").header("Origin", "https://untrusted.example"))
                .andExpect(status().isForbidden());
        verifyNoMoreInteractions(sessions);
    }
}
