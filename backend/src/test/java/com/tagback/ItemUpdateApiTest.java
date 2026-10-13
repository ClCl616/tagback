package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.ItemController;
import com.tagback.domain.entity.*;
import com.tagback.dto.item.*;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ItemController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, AuthOriginGuard.class})
class ItemUpdateApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean ItemService items;
    @MockitoBean SessionService sessions;

    @BeforeEach void authenticate() {
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(1L, UserRole.ADMIN));
        when(sessions.authenticate("user")).thenReturn(new AuthenticatedUser(2L, UserRole.USER));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test void updatesOnlyProvidedFields() throws Exception {
        when(items.update(eq(10L), any())).thenAnswer(invocation -> {
            ItemRequests.Update body = invocation.getArgument(1);
            org.junit.jupiter.api.Assertions.assertEquals("우산 02", body.getItemName());
            org.junit.jupiter.api.Assertions.assertNull(body.getItemTypeId());
            return new ItemResponses.Detail("10", body.getItemName(), "1", "우산", ItemStatus.RENTED,
                    OffsetDateTime.parse("2026-10-07T01:00:00Z"));
        });
        mvc.perform(patch("/api/v1/items/10").cookie(cookie("admin")).contentType("application/json")
                .content("{\"itemName\":\"  우산 02  \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.itemName").value("우산 02"))
                .andExpect(jsonPath("$.status").value("RENTED"));
    }

    @Test void rejectsEmptyNullUnknownAndInvalidValues() throws Exception {
        for (String body : List.of("{}", "null", "{\"itemName\":null}", "{\"itemTypeId\":null}",
                "{\"itemName\":\"   \"}", "{\"itemName\":\"우산\",\"itemTypeId\":null}",
                "{\"itemTypeId\":\"0\"}", "{\"itemTypeId\":\"9223372036854775808\"}",
                "{\"itemName\":\"우산\",\"status\":\"AVAILABLE\"}",
                "{\"itemName\":\"" + "a".repeat(101) + "\"}")) {
            mvc.perform(patch("/api/v1/items/10").cookie(cookie("admin")).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        mvc.perform(patch("/api/v1/items/0").cookie(cookie("admin")).contentType("application/json")
                .content("{\"itemName\":\"우산\"}")).andExpect(status().isBadRequest());
        verifyNoInteractions(items);
    }

    @Test void requiresAdminAndAllowedOrigin() throws Exception {
        for (String token : List.of("user", "admin")) {
            var request = patch("/api/v1/items/10").cookie(cookie(token)).contentType("application/json")
                    .content("{\"itemName\":\"우산\"}");
            if (token.equals("admin")) request.header("Origin", "https://other.example");
            mvc.perform(request).andExpect(status().isForbidden());
        }
        mvc.perform(patch("/api/v1/items/10").contentType("application/json")
                .content("{\"itemName\":\"우산\"}")).andExpect(status().isUnauthorized());
        verifyNoInteractions(items);
    }

    @Test void returnsMissingAndConflictErrors() throws Exception {
        for (ItemException failure : List.of(ItemException.itemNotFound(), new ItemException(), ItemException.typeChangeConflict())) {
            when(items.update(eq(10L), any())).thenThrow(failure);
            mvc.perform(patch("/api/v1/items/10").cookie(cookie("admin")).contentType("application/json")
                    .content("{\"itemTypeId\":\"2\"}"))
                    .andExpect(status().is(failure.status())).andExpect(jsonPath("$.error.code").value(failure.code()));
        }
    }

    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
}
