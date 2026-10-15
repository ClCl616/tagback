package com.tagback;

import com.tagback.config.ApiAccessConfiguration;
import com.tagback.controller.TagLookupController;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.service.SessionService;
import com.tagback.service.TagLifecycleService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(TagLookupController.class)
@ActiveProfiles("test")
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class})
class TagLookupGrantProfileBoundaryTest {
    @Autowired MockMvc mvc;
    @MockitoBean SessionService sessions;
    @MockitoBean TagLifecycleService lifecycle;

    @Test void rentalGrantFailsClosedWhenMockAuthenticationIsUnavailable() throws Exception {
        mvc.perform(get("/api/tags/04A23B1C5D6E80")
                        .header("Authorization", "Bearer " + "x".repeat(43)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_INVALID"));
        verifyNoInteractions(sessions, lifecycle);
    }
}
