package com.tagback;

import com.tagback.config.ApiAccessConfiguration;
import com.tagback.config.AuthCookies;
import com.tagback.config.AuthenticatedUser;
import com.tagback.domain.repository.RentalAuthorizationStore.Grant;
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
import com.tagback.exception.RentalException;
import com.tagback.service.RentalCodeService;
import com.tagback.service.SessionService;
import com.tagback.service.TagLifecycleService;
import com.tagback.service.TagRegistrationService;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({TagLifecycleController.class, TagLookupController.class, com.tagback.controller.TagRegistrationController.class})
@ActiveProfiles("kakao-auth")
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class})
class TagLifecycleAuthorizationTest extends SharedAdminMvcSupport {
    @Autowired MockMvc mvc;
    @MockitoBean SessionService sessions;
    @MockitoBean RentalCodeService rentalCodes;
    @MockitoBean TagLifecycleService lifecycle;
    @MockitoBean TagRegistrationService registration;

    @Test
    void replacementAndDeactivationRequireSession() throws Exception {
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        mvc.perform(put("/api/items/12/tag").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"04A23B1C5D6E80\",\"expectedUid\":null}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        mvc.perform(delete("/api/items/12/tag").param("expectedUid", "04A23B1C5D6E80"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        mvc.perform(get("/api/tags/04A23B1C5D6E80"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        verifyNoInteractions(lifecycle);
    }

    @Test
    void userCannotReplaceOrDeactivateButCanLookUp() throws Exception {
        when(sessions.authenticate("user-session")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));
        Cookie user = new Cookie(AuthCookies.SESSION_COOKIE, "user-session");
        mvc.perform(put("/api/items/12/tag").cookie(user).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"04A23B1C5D6E80\",\"expectedUid\":null}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        mvc.perform(delete("/api/items/12/tag").cookie(user).param("expectedUid", "04A23B1C5D6E80"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        when(lifecycle.lookup("04A23B1C5D6E80")).thenReturn(new TagLookupResponse(
                new TagLookupResponse.Item(12L, "공용 물품", ItemStatus.AVAILABLE, true, "3", "공용 우산"),
                new TagLookupResponse.Tag("04A23B1C5D6E80", "ACTIVE")));
        mvc.perform(get("/api/tags/04A23B1C5D6E80").cookie(user))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.itemId").value(12))
                .andExpect(jsonPath("$.item.itemTypeId").value("3"))
                .andExpect(jsonPath("$.item.itemTypeName").value("공용 우산"))
                .andExpect(jsonPath("$.item.rentable").value(true))
                .andExpect(jsonPath("$.tag.status").value("ACTIVE"));
    }

    @Test
    void sharedAdministratorCannotUseRetiredUidOnlyWrites() throws Exception {
        var cookie=new Cookie(com.tagback.config.AdminCredentials.COOKIE,"admin-session");
        mvc.perform(put("/api/items/12/tag").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
                .content("{\"uid\":\"04A23B1C5D6E80\",\"expectedUid\":null}"))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/items/12/tag").cookie(cookie).param("expectedUid","04A23B1C5D6E80"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(lifecycle);
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

    @Test
    void rentalGrantCanLookUpTagWithoutMobileSession() throws Exception {
        String token = "x".repeat(43);
        when(rentalCodes.authenticate(token)).thenReturn(new Grant(UUID.randomUUID(), UUID.randomUUID(),
                Instant.now().plusSeconds(60)));
        when(lifecycle.lookup("04A23B1C5D6E80")).thenReturn(new TagLookupResponse(
                new TagLookupResponse.Item(12L, "공용 물품", ItemStatus.AVAILABLE, true, "3", "공용 우산"),
                new TagLookupResponse.Tag("04A23B1C5D6E80", "ACTIVE")));
        mvc.perform(get("/api/tags/04A23B1C5D6E80").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.itemId").value(12))
                .andExpect(jsonPath("$.item.itemTypeId").value("3"))
                .andExpect(jsonPath("$.item.itemTypeName").value("공용 우산"))
                .andExpect(jsonPath("$.tag.status").value("ACTIVE"));
        verifyNoInteractions(sessions);
    }

    @Test
    void rentalGrantKeepsTagLookupErrorCodes() throws Exception {
        String token = "x".repeat(43);
        when(rentalCodes.authenticate(token)).thenReturn(new Grant(UUID.randomUUID(), UUID.randomUUID(),
                Instant.now().plusSeconds(60)));
        when(lifecycle.lookup("04A23B1C5D6E80")).thenThrow(
                new TagRegistrationException(HttpStatus.NOT_FOUND, "TAG_NOT_FOUND", "태그를 찾을 수 없습니다."));
        mvc.perform(get("/api/tags/04A23B1C5D6E80").header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("TAG_NOT_FOUND"));
        when(lifecycle.lookup("04A23B1C5D6E81")).thenThrow(
                new TagRegistrationException(HttpStatus.CONFLICT, "TAG_INACTIVE", "비활성화된 태그입니다."));
        mvc.perform(get("/api/tags/04A23B1C5D6E81").header("Authorization", "Bearer " + token))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("TAG_INACTIVE"));
    }

    @Test
    void invalidOrExpiredGrantCannotFallBackToMobileSession() throws Exception {
        Cookie user = new Cookie(AuthCookies.SESSION_COOKIE, "user-session");
        when(sessions.authenticate("user-session")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));
        String token = "x".repeat(43);
        when(rentalCodes.authenticate(token)).thenThrow(RentalException.grantInvalid());
        mvc.perform(get("/api/tags/04A23B1C5D6E80").cookie(user)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_INVALID"));
        mvc.perform(get("/api/tags/04A23B1C5D6E80").header("Authorization", "Bearer bad"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_INVALID"));
        doThrow(RentalException.grantExpired()).when(rentalCodes).authenticate(token);
        mvc.perform(get("/api/tags/04A23B1C5D6E80").header("Authorization", "Bearer " + token))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_EXPIRED"));
        verifyNoInteractions(sessions, lifecycle);
    }

    @Test
    void rentalGrantDoesNotAuthorizeTagChanges() throws Exception {
        String token = "x".repeat(43);
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        mvc.perform(put("/api/items/12/tag").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"04A23B1C5D6E80\",\"expectedUid\":null}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        mvc.perform(delete("/api/items/12/tag").header("Authorization", "Bearer " + token)
                        .param("expectedUid", "04A23B1C5D6E80"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        verifyNoInteractions(rentalCodes, lifecycle);
    }
}
