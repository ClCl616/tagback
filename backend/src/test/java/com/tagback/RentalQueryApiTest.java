package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.RentalQueryController;
import com.tagback.domain.entity.UserRole;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.exception.*;
import com.tagback.service.RentalQueryService;
import com.tagback.service.SessionService;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(RentalQueryController.class)
@ActiveProfiles("sms-mock")
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class})
class RentalQueryApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean RentalQueryService queries;
    @MockitoBean SessionService sessions;

    @BeforeEach void authenticate() {
        when(sessions.authenticate("member")).thenReturn(new AuthenticatedUser(42L, UserRole.USER));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test void usesOnlyAuthenticatedIdentityForTheRentalQuery() throws Exception {
        var now = Instant.parse("2026-10-14T03:00:00Z");
        when(queries.list(42L, "ACTIVE", 0, 20))
                .thenReturn(new RentalResponses.RentalPage(List.of(), 0, 20, 0, 0, now));

        mvc.perform(get("/api/v1/rentals/me").cookie(cookie("member")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.rentals").isEmpty())
                .andExpect(jsonPath("$.evaluatedAt").value(now.toString()));
        verify(queries).list(42L, "ACTIVE", 0, 20);
    }

    @Test void rejectsClientSuppliedUserId() throws Exception {
        mvc.perform(get("/api/v1/rentals/me").cookie(cookie("member")).param("userId", "99"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        verifyNoInteractions(queries);
    }

    @Test void rejectsAnonymousRequestBeforeQueryingRentals() throws Exception {
        mvc.perform(get("/api/v1/rentals/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        verifyNoInteractions(queries);
    }

    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
}
