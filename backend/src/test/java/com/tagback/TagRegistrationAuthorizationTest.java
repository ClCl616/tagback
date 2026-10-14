package com.tagback;

import com.tagback.config.ApiAccessConfiguration;
import com.tagback.config.AuthCookies;
import com.tagback.config.AuthenticatedUser;
import com.tagback.controller.TagRegistrationController;
import com.tagback.domain.entity.UserRole;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.SessionService;
import com.tagback.service.TagRegistrationService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(TagRegistrationController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class})
class TagRegistrationAuthorizationTest {
    @Autowired MockMvc mvc;
    @MockitoBean SessionService sessions;
    @MockitoBean TagRegistrationService registrationService;

    @Test
    void missingSessionCannotRegisterTag() throws Exception {
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));

        mvc.perform(request())
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));

        verifyNoInteractions(registrationService);
    }

    @Test
    void ordinaryUserCannotRegisterTag() throws Exception {
        when(sessions.authenticate("user-session")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));

        mvc.perform(request().cookie(new Cookie(AuthCookies.SESSION_COOKIE, "user-session")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        verifyNoInteractions(registrationService);
    }

    @Test
    void adminCanRegisterTag() throws Exception {
        when(sessions.authenticate("admin-session")).thenReturn(new AuthenticatedUser(8L, UserRole.ADMIN));
        when(registrationService.register(12L, "04A23B1C5D6E80", 8L)).thenReturn(
                new TagRegistrationService.RegistrationResult(new TagRegistrationResponse(
                        new TagRegistrationResponse.Tag(1L, "04A23B1C5D6E80", 12L, "ACTIVE", null)), true));

        mvc.perform(request().cookie(new Cookie(AuthCookies.SESSION_COOKIE, "admin-session")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tag.tagId").value(1))
                .andExpect(jsonPath("$.tag.itemId").value(12));
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request() {
        return post("/api/items/12/tag")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"uid\":\"04A23B1C5D6E80\"}");
    }
}
