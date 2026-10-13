package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.ItemController;
import com.tagback.domain.entity.*;
import com.tagback.dto.item.ItemResponses;
import com.tagback.exception.*;
import com.tagback.service.*;
import jakarta.servlet.http.Cookie;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ItemController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, AuthOriginGuard.class})
class ItemQueryApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean ItemService items;
    @MockitoBean SessionService sessions;

    @BeforeEach void authenticate() {
        when(sessions.authenticate("user")).thenReturn(new AuthenticatedUser(2L, UserRole.USER));
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(1L, UserRole.ADMIN));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test void userAndAdminCanReadDetail() throws Exception {
        when(items.detail(10L)).thenReturn(new ItemResponses.Detail("10", "우산", "1", "우산",
                ItemStatus.REPAIR, OffsetDateTime.parse("2026-10-07T01:00:00Z")));
        for (String token : List.of("user", "admin")) {
            mvc.perform(get("/api/v1/items/10").cookie(cookie(token)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.itemId").value("10"))
                    .andExpect(jsonPath("$.status").value("REPAIR"));
        }
    }

    @Test void listUsesDefaultsAndPassesFilters() throws Exception {
        when(items.list(0, 20, null, null)).thenReturn(new ItemResponses.ItemPage(List.of(), 0, 20, 0, 0));
        mvc.perform(get("/api/v1/items").cookie(cookie("user")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.page").value(0)).andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(0)).andExpect(jsonPath("$.totalPages").value(0));
        when(items.list(1, 5, 2L, ItemStatus.AVAILABLE))
                .thenReturn(new ItemResponses.ItemPage(List.of(), 1, 5, 0, 0));
        mvc.perform(get("/api/v1/items").cookie(cookie("user")).param("page", "1").param("size", "5")
                .param("itemTypeId", "2").param("status", "AVAILABLE")).andExpect(status().isOk());
        verify(items).list(1, 5, 2L, ItemStatus.AVAILABLE);
    }

    @Test void rejectsInvalidIdsAndQueryParameters() throws Exception {
        for (String path : List.of("/api/v1/items/0", "/api/v1/items/-1", "/api/v1/items/abc",
                "/api/v1/items/9223372036854775808", "/api/v1/items?page=-1", "/api/v1/items?size=0",
                "/api/v1/items?size=101", "/api/v1/items?page=2147483648", "/api/v1/items?itemTypeId=0",
                "/api/v1/items?itemTypeId=9223372036854775808", "/api/v1/items?status=available")) {
            mvc.perform(get(path).cookie(cookie("user"))).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        verifyNoInteractions(items);
    }

    @Test void missingItemReturns404() throws Exception {
        when(items.detail(99L)).thenThrow(ItemException.itemNotFound());
        mvc.perform(get("/api/v1/items/99").cookie(cookie("user"))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ITEM_NOT_FOUND"));
    }

    @Test void anonymousCannotReadEitherEndpoint() throws Exception {
        for (String path : List.of("/api/v1/items", "/api/v1/items/10")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
        verifyNoInteractions(items);
    }

    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
}
