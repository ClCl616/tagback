package com.tagback;

import com.tagback.config.ApiAccessConfiguration;
import com.tagback.config.AuthCookies;
import com.tagback.config.AuthenticatedUser;
import com.tagback.controller.ItemTypeController;
import com.tagback.controller.TagLifecycleController;
import com.tagback.domain.entity.UserRole;
import com.tagback.domain.repository.RentalAuthorizationStore.Grant;
import com.tagback.dto.item.ItemTypeResponses;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.exception.RentalException;
import com.tagback.service.ItemTypeService;
import com.tagback.service.RentalCodeService;
import com.tagback.service.SessionService;
import com.tagback.service.TagLifecycleService;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({ItemTypeController.class, TagLifecycleController.class})
@ActiveProfiles("sms-mock")
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class})
class ItemTypeApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean ItemTypeService types;
    @MockitoBean TagLifecycleService lifecycle;
    @MockitoBean SessionService sessions;
    @MockitoBean RentalCodeService rentalCodes;

    private static final String TOKEN = "x".repeat(43);
    private static final ItemTypeResponses.ListResult RESULT = new ItemTypeResponses.ListResult(
            List.of(new ItemTypeResponses.Detail("3", "공용 우산")));

    @Test
    void validRentalGrantCanReadTypesButNotAdminTagEndpoint() throws Exception {
        when(rentalCodes.authenticate(TOKEN)).thenReturn(new Grant(UUID.randomUUID(), UUID.randomUUID(),
                Instant.now().plusSeconds(60)));
        when(types.list()).thenReturn(RESULT);
        mvc.perform(get("/api/v1/item-types").header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.itemTypes[0].itemTypeId").value("3"))
                .andExpect(jsonPath("$.itemTypes[0].itemTypeName").value("공용 우산"))
                .andExpect(jsonPath("$.itemTypes[0].items").doesNotExist());
        verifyNoInteractions(sessions);
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        mvc.perform(put("/api/items/12/tag").header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        verifyNoInteractions(lifecycle);
    }

    @Test
    void loggedInUserCanReadTypes() throws Exception {
        when(sessions.authenticate("user-session")).thenReturn(new AuthenticatedUser(7L, UserRole.USER));
        when(types.list()).thenReturn(RESULT);
        mvc.perform(get("/api/v1/item-types")
                        .cookie(new Cookie(AuthCookies.SESSION_COOKIE, "user-session")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.itemTypes[0].itemTypeId").value("3"));
        verifyNoInteractions(rentalCodes);
    }

    @Test
    void missingOrInvalidCredentialsAreRejected() throws Exception {
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
        mvc.perform(get("/api/v1/item-types"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        when(rentalCodes.authenticate(TOKEN)).thenThrow(RentalException.grantInvalid());
        mvc.perform(get("/api/v1/item-types").header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_INVALID"));
        mvc.perform(get("/api/v1/item-types").header("Authorization", "Bearer bad"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("RENTAL_GRANT_INVALID"));
        verifyNoInteractions(types);
    }
}
