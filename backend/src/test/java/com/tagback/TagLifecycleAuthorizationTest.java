package com.tagback;

import com.tagback.config.ApiAccessConfiguration;
import com.tagback.config.AuthCookies;
import com.tagback.config.AuthenticatedUser;
import com.tagback.controller.TagLifecycleController;
import com.tagback.controller.TagLookupController;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.UserRole;
import com.tagback.dto.tag.TagLookupResponse;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.SessionService;
import com.tagback.service.TagLifecycleService;
import com.tagback.service.TagRegistrationService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({TagLifecycleController.class, TagLookupController.class})
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class})
class TagLifecycleAuthorizationTest {
    @Autowired MockMvc mvc;
    @MockitoBean SessionService sessions;
    @MockitoBean TagLifecycleService lifecycle;

    @Test
    void replacementAndDeactivationRequireSession() throws Exception {
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        mvc.perform(put("/api/items/12/tag").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"04A23B1C5D6E80\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        mvc.perform(delete("/api/items/12/tag"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        mvc.perform(get("/api/tags/04A23B1C5D6E80"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(lifecycle);
    }

    @Test
    void userCannotReplaceOrDeactivateButCanLookUp() throws Exception {
        when(sessions.authenticate("user-session")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));
        Cookie user = new Cookie(AuthCookies.SESSION_COOKIE, "user-session");
        mvc.perform(put("/api/items/12/tag").cookie(user).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"04A23B1C5D6E80\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        mvc.perform(delete("/api/items/12/tag").cookie(user))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        when(lifecycle.lookup("04A23B1C5D6E80")).thenReturn(new TagLookupResponse(
                new TagLookupResponse.Item(12L, "공용 물품", ItemStatus.AVAILABLE, true),
                new TagLookupResponse.Tag("04A23B1C5D6E80", "ACTIVE")));
        mvc.perform(get("/api/tags/04A23B1C5D6E80").cookie(user))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.itemId").value(12))
                .andExpect(jsonPath("$.item.rentable").value(true))
                .andExpect(jsonPath("$.tag.status").value("ACTIVE"));
    }

    @Test
    void adminCanReplaceAndDeactivateAndRetryGetsOk() throws Exception {
        when(sessions.authenticate("admin-session")).thenReturn(new AuthenticatedUser(8L, UserRole.ADMIN));
        Cookie admin = new Cookie(AuthCookies.SESSION_COOKIE, "admin-session");
        TagRegistrationResponse response = new TagRegistrationResponse(
                new TagRegistrationResponse.Tag(1L, "04A23B1C5D6E80", 12L, "ACTIVE", null));
        when(lifecycle.replace(12L, "04A23B1C5D6E80"))
                .thenReturn(new TagRegistrationService.RegistrationResult(response, true),
                        new TagRegistrationService.RegistrationResult(response, false));
        for (int i = 0; i < 2; i++) {
            mvc.perform(put("/api/items/12/tag").cookie(admin).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"uid\":\"04A23B1C5D6E80\"}"))
                    .andExpect(i == 0 ? status().isCreated() : status().isOk())
                    .andExpect(jsonPath("$.tag.tagId").value(1));
        }
        mvc.perform(delete("/api/items/12/tag").cookie(admin)).andExpect(status().isNoContent());
    }

    @Test
    void lookupErrorsUseSharedEnvelope() throws Exception {
        when(sessions.authenticate("user-session")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));
        when(lifecycle.lookup("04A23B1C5D6E80")).thenThrow(
                new TagRegistrationException(HttpStatus.CONFLICT, "TAG_INACTIVE", "비활성화된 태그입니다."));
        mvc.perform(get("/api/tags/04A23B1C5D6E80")
                        .cookie(new Cookie(AuthCookies.SESSION_COOKIE, "user-session")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("TAG_INACTIVE"));

        when(lifecycle.lookup("04A23B1C5D6E81")).thenThrow(
                new TagRegistrationException(HttpStatus.NOT_FOUND, "TAG_NOT_FOUND", "태그를 찾을 수 없습니다."));
        mvc.perform(get("/api/tags/04A23B1C5D6E81")
                        .cookie(new Cookie(AuthCookies.SESSION_COOKIE, "user-session")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("TAG_NOT_FOUND"));
    }
}
