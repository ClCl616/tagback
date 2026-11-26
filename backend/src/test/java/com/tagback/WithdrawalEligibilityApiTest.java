package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.WithdrawalEligibilityController;
import com.tagback.domain.entity.UserRole;
import com.tagback.exception.*;
import com.tagback.service.SessionService;
import com.tagback.service.WithdrawalEligibilityService;
import jakarta.servlet.http.Cookie;
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

@WebMvcTest(WithdrawalEligibilityController.class)
@ActiveProfiles("kakao-auth")
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class})
class WithdrawalEligibilityApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean WithdrawalEligibilityService eligibility;
    @MockitoBean SessionService sessions;

    @Test void usesSessionIdentityAndDoesNotCacheResult() throws Exception {
        when(sessions.authenticate("member")).thenReturn(new AuthenticatedUser(42L, UserRole.USER));
        when(eligibility.hasOutstandingRentals(42L)).thenReturn(true);
        mvc.perform(get("/api/v1/account/outstanding-rentals")
                        .cookie(new Cookie(AuthCookies.SESSION_COOKIE, "member")).param("userId", "99"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.hasOutstandingRentals").value(true));
        verify(eligibility).hasOutstandingRentals(42L);
    }

    @Test void rejectsMissingSession() throws Exception {
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        mvc.perform(get("/api/v1/account/outstanding-rentals"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(eligibility);
    }
}
