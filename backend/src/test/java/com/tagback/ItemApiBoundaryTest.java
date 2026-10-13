package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.ItemController;
import com.tagback.domain.entity.UserRole;
import com.tagback.exception.*;
import com.tagback.service.*;
import jakarta.servlet.http.Cookie;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ItemController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, ItemApiExceptionHandler.class, AuthOriginGuard.class})
class ItemApiBoundaryTest {
    @Autowired MockMvc mvc;
    @MockitoBean ItemService items;
    @MockitoBean SessionService sessions;

    @BeforeEach void authenticate() {
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(1L, UserRole.ADMIN));
        when(sessions.authenticate("user")).thenReturn(new AuthenticatedUser(2L, UserRole.USER));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test void rejectsWrongJsonTypesMalformedBodiesAndLongNames() throws Exception {
        for (String body : List.of("{", "[]", "{\"itemName\":123,\"itemTypeId\":\"1\"}",
                "{\"itemName\":true,\"itemTypeId\":\"1\"}", "{\"itemName\":\"우산\",\"itemTypeId\":1}",
                "{\"itemName\":\"우산\",\"itemTypeId\":true}",
                "{\"itemName\":\"" + "a".repeat(101) + "\",\"itemTypeId\":\"1\"}")) {
            mvc.perform(post("/api/v1/items").cookie(cookie("admin")).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        for (String body : List.of("{\"itemName\":123}", "{\"itemTypeId\":1}", "{\"itemName\":false}")) {
            mvc.perform(patch("/api/v1/items/10").cookie(cookie("admin")).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        verifyNoInteractions(items);
    }

    @Test void rejectsEmptyStatusAndTypeFilters() throws Exception {
        for (String path : List.of("/api/v1/items?status=", "/api/v1/items?itemTypeId=")) {
            mvc.perform(get(path).cookie(cookie("user"))).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        verifyNoInteractions(items);
    }

    @Test void returnsConsistent415And405WithoutWrites() throws Exception {
        mvc.perform(post("/api/v1/items").cookie(cookie("admin")).contentType("text/plain").content("secret"))
                .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.error.code").value("UNSUPPORTED_MEDIA_TYPE"));
        mvc.perform(put("/api/v1/items/10").cookie(cookie("admin")))
                .andExpect(status().isMethodNotAllowed()).andExpect(header().exists("Allow"))
                .andExpect(jsonPath("$.error.code").value("METHOD_NOT_ALLOWED"));
        verifyNoInteractions(items);
    }

    @Test void expiredAndRevokedSessionsFailOnEveryCrudEndpoint() throws Exception {
        for (var code : List.of(AuthErrorCode.SESSION_EXPIRED, AuthErrorCode.SESSION_REPLACED)) {
            doThrow(new AuthException(code)).when(sessions).authenticate("invalid");
            var requests = List.of(get("/api/v1/items"), get("/api/v1/items/10"), post("/api/v1/items"),
                    patch("/api/v1/items/10"), delete("/api/v1/items/10"));
            for (var request : requests) {
                mvc.perform(request.cookie(cookie("invalid")))
                        .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value(code.name()));
            }
        }
        verifyNoInteractions(items);
    }

    @Test void duplicateSessionCookiesAreRejectedBeforeAuthentication() throws Exception {
        mvc.perform(delete("/api/v1/items/10").cookie(cookie("admin"), cookie("user")))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("SESSION_REQUIRED"));
        verifyNoInteractions(items);
        verify(sessions, never()).authenticate(any());
    }

    @Test void clientRoleAndCrossSiteMetadataCannotPermitWrites() throws Exception {
        mvc.perform(delete("/api/v1/items/10").cookie(cookie("user")).param("role", "ADMIN").header("X-Role", "ADMIN"))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/items/10").cookie(cookie("admin")).header("Sec-Fetch-Site", "cross-site"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(items);
    }

    @Test void unexpectedStorageFailureReturnsSanitized500() throws Exception {
        when(items.detail(10L)).thenThrow(new DataAccessResourceFailureException("secret SQL and connection details"));
        mvc.perform(get("/api/v1/items/10").cookie(cookie("user"))).andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.error.retryAt").isEmpty())
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("secret"))));
    }

    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
}
