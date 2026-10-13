package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.ItemController;
import com.tagback.domain.entity.*;
import com.tagback.dto.item.ItemRequests;
import com.tagback.dto.item.ItemResponses;
import com.tagback.exception.*;
import com.tagback.service.ItemService;
import com.tagback.service.SessionService;
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

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ItemController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, AuthOriginGuard.class})
class ItemStatusApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean ItemService items;
    @MockitoBean SessionService sessions;

    @BeforeEach void authenticate() {
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(77L, UserRole.ADMIN));
        when(sessions.authenticate("user")).thenReturn(new AuthenticatedUser(22L, UserRole.USER));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test void changesStatusAndReturnsUpdatedItem() throws Exception {
        when(items.changeStatus(eq(10L), any(), eq(77L))).thenAnswer(invocation -> {
            var body = invocation.getArgument(1, ItemRequests.StatusChange.class);
            org.junit.jupiter.api.Assertions.assertEquals("우산 손상", body.getReason());
            return detail(ItemStatus.REPAIR);
        });
        mvc.perform(patch("/api/v1/items/10/status").cookie(cookie("admin"))
                        .contentType("application/json").content("{\"status\":\"REPAIR\",\"reason\":\" 우산 손상 \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.itemId").value("10"))
                .andExpect(jsonPath("$.status").value("REPAIR"));
        verify(items).changeStatus(eq(10L), any(), eq(77L));
    }

    @Test void rejectsMalformedAndUnmanageableStatusRequests() throws Exception {
        for (String body : List.of("{}", "null", "{\"status\":null}", "{\"status\":\"UNKNOWN\"}",
                "{\"status\":\"TAG_PENDING\"}", "{\"status\":\"RENTED\"}",
                "{\"status\":12}", "{\"status\":\"AVAILABLE\",\"reason\":null}",
                "{\"status\":\"AVAILABLE\",\"other\":true}",
                "{\"status\":\"AVAILABLE\",\"reason\":\"" + "x".repeat(501) + "\"}")) {
            mvc.perform(patch("/api/v1/items/10/status").cookie(cookie("admin"))
                            .contentType("application/json").content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        mvc.perform(patch("/api/v1/items/0/status").cookie(cookie("admin"))
                        .contentType("application/json").content("{\"status\":\"AVAILABLE\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(items);
    }

    @Test void requiresAdminAndAllowedOrigin() throws Exception {
        for (String token : List.of("user", "admin")) {
            var request = patch("/api/v1/items/10/status").cookie(cookie(token))
                    .contentType("application/json").content("{\"status\":\"INSPECTION\"}");
            if (token.equals("admin")) request.header("Origin", "https://other.example");
            mvc.perform(request).andExpect(status().isForbidden());
        }
        mvc.perform(patch("/api/v1/items/10/status").contentType("application/json")
                        .content("{\"status\":\"INSPECTION\"}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(items);
    }

    @Test void returnsMissingAndStateConflict() throws Exception {
        when(items.changeStatus(eq(10L), any(), eq(77L))).thenThrow(ItemException.itemNotFound());
        mvc.perform(patch("/api/v1/items/10/status").cookie(cookie("admin")).contentType("application/json")
                        .content("{\"status\":\"INSPECTION\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("ITEM_NOT_FOUND"));
        when(items.changeStatus(eq(10L), any(), eq(77L))).thenThrow(ItemException.statusChangeConflict());
        mvc.perform(patch("/api/v1/items/10/status").cookie(cookie("admin")).contentType("application/json")
                        .content("{\"status\":\"INSPECTION\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("ITEM_STATUS_CHANGE_CONFLICT"));
    }

    private ItemResponses.Detail detail(ItemStatus status) {
        return new ItemResponses.Detail("10", "우산 01", "1", "우산", status,
                OffsetDateTime.parse("2026-10-07T01:00:00Z"));
    }

    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
}
