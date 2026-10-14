package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.RentalController;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.service.RentalOperationService;
import com.tagback.service.SessionService;
import jakarta.servlet.http.Cookie;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(RentalController.class)
@ActiveProfiles("sms-mock")
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, AuthOriginGuard.class})
class RentalAuthenticationBoundaryTest {
    @Autowired MockMvc mvc;
    @MockitoBean RentalOperationService operations;
    @MockitoBean SessionService sessions;
    // RentalCodeService deliberately absent: the API must fail closed, even with a mobile cookie.
    @Test void unavailableGrantAuthenticationCannotFallBackToMobileSession() throws Exception {
        mvc.perform(post("/api/v1/rentals").cookie(new Cookie(AuthCookies.SESSION_COOKIE, "mobile-session"))
                .header("Authorization", "Bearer " + "x".repeat(43)).header("Idempotency-Key", UUID.randomUUID())
                .contentType("application/json").content("{\"itemId\":\"1\",\"itemTypeId\":\"1\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_INVALID"));
        verifyNoInteractions(operations, sessions);
    }

    @Test void missingGrantIsRejectedBeforeMalformedBodyIsParsed() throws Exception {
        mvc.perform(post("/api/v1/rentals").contentType("application/json").content("{"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_REQUIRED"));
        verifyNoInteractions(operations, sessions);
    }
}
