package com.tagback;

import com.tagback.config.*;
import com.tagback.domain.entity.UserRole;
import com.tagback.exception.*;
import com.tagback.service.SessionService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest({SessionAuthorizationTest.MixedController.class, SessionAuthorizationTest.AdminController.class})
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class,
        SessionAuthorizationTest.MixedController.class, SessionAuthorizationTest.AdminController.class})
class SessionAuthorizationTest {
    @Autowired MockMvc mvc;
    @Autowired MixedController mixed;
    @Autowired AdminController admin;
    @MockitoBean SessionService sessions;

    @RestController
    static class MixedController {
        final AtomicInteger writes = new AtomicInteger();

        @AdminOnly
        @PostMapping("/api/v1/test/admin-write")
        public String write() { writes.incrementAndGet(); return "saved"; }

        @GetMapping("/api/v1/test/member")
        public String member() { return "member"; }
    }

    @AdminOnly
    @RestController
    static class AdminController {
        final AtomicInteger writes = new AtomicInteger();

        // Deliberately conflicting markers: controller-level ADMIN must still be enforced.
        @PublicApi
        @PostMapping("/api/v1/test/admin-controller")
        public String write() { writes.incrementAndGet(); return "saved"; }
    }

    @BeforeEach void resetWrites() {
        mixed.writes.set(0);
        admin.writes.set(0);
    }

    @Test void missingSessionReturns401OnBothAdminScopes() throws Exception {
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        for (String path : adminPaths()) {
            mvc.perform(post(path)).andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        }
        assertNoWrites();
    }

    @Test void expiredRevokedAndUnknownSessionsReturn401BeforeRoleCheck() throws Exception {
        for (var code : new AuthErrorCode[]{AuthErrorCode.SESSION_EXPIRED, AuthErrorCode.SESSION_REPLACED,
                AuthErrorCode.SESSION_REQUIRED}) {
            doThrow(new AuthException(code)).when(sessions).authenticate("invalid");
            for (String path : adminPaths()) {
                mvc.perform(post(path).cookie(cookie("invalid")))
                        .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value(code.name()));
            }
        }
        assertNoWrites();
    }

    @Test void userGets403AndClientRoleCannotOverrideServerRole() throws Exception {
        when(sessions.authenticate("user")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));
        for (String path : adminPaths()) {
            mvc.perform(post(path).cookie(cookie("user")).param("role", "ADMIN").header("X-Role", "ADMIN"))
                    .andExpect(status().isForbidden())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                    .andExpect(jsonPath("$.error.message").value("접근 권한이 없습니다."));
        }
        assertNoWrites();
    }

    @Test void adminCanReachBothAdminScopes() throws Exception {
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(8L, UserRole.ADMIN));
        for (String path : adminPaths()) {
            mvc.perform(post(path).cookie(cookie("admin")))
                    .andExpect(status().isOk()).andExpect(content().string("saved"));
        }
        assertEquals(1, mixed.writes.get());
        assertEquals(1, admin.writes.get());
    }

    @Test void roleIsRecheckedOnEveryRequestAndDemotionStopsWrites() throws Exception {
        when(sessions.authenticate("session"))
                .thenReturn(new AuthenticatedUser(8L, UserRole.ADMIN), new AuthenticatedUser(8L, UserRole.USER));
        mvc.perform(post(adminPaths()[0]).cookie(cookie("session"))).andExpect(status().isOk());
        mvc.perform(post(adminPaths()[0]).cookie(cookie("session"))).andExpect(status().isForbidden());
        assertEquals(1, mixed.writes.get());
        verify(sessions, times(2)).authenticate("session");
    }

    @Test void userAndAdminCanStillReachOrdinaryAuthenticatedApi() throws Exception {
        for (var role : UserRole.values()) {
            when(sessions.authenticate(role.name())).thenReturn(new AuthenticatedUser(7L, role));
            mvc.perform(get("/api/v1/test/member").cookie(cookie(role.name())))
                    .andExpect(status().isOk()).andExpect(content().string("member"));
        }
    }

    private String[] adminPaths() { return new String[]{"/api/v1/test/admin-write", "/api/v1/test/admin-controller"}; }
    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
    private void assertNoWrites() {
        assertEquals(0, mixed.writes.get());
        assertEquals(0, admin.writes.get());
    }
}
