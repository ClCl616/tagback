package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.ItemController;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.UserRole;
import com.tagback.dto.item.ItemRequests;
import com.tagback.dto.item.ItemResponses;
import com.tagback.exception.*;
import com.tagback.service.ItemService;
import com.tagback.service.SessionService;
import jakarta.servlet.http.Cookie;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ItemController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, AuthOriginGuard.class})
class ItemRegistrationApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean ItemService items;
    @MockitoBean SessionService sessions;

    @BeforeEach
    void authenticate() {
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(1L, UserRole.ADMIN));
        when(sessions.authenticate("user")).thenReturn(new AuthenticatedUser(2L, UserRole.USER));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test
    void createsItemAndReturnsLocation() throws Exception {
        var body = new ItemRequests.Create("우산 01", "1");
        when(items.create(body)).thenReturn(new ItemResponses.Detail("10", "우산 01", "1", "우산",
                ItemStatus.TAG_PENDING, OffsetDateTime.parse("2026-10-07T01:00:00Z")));
        mvc.perform(post("/api/v1/items").cookie(cookie("admin")).contentType("application/json")
                .content("{\"itemName\":\"  우산 01  \",\"itemTypeId\":\"1\"}"))
                .andExpect(status().isCreated()).andExpect(header().string("Location", "/api/v1/items/10"))
                .andExpect(jsonPath("$.itemId").value("10"))
                .andExpect(jsonPath("$.status").value("TAG_PENDING"))
                .andExpect(jsonPath("$.createdAt").isString());
        verify(items).create(body);
    }

    @Test
    void rejectsInvalidAndUnknownFieldsBeforeSaving() throws Exception {
        for (String body : new String[]{"{}", "null",
                "{\"itemName\":\"   \",\"itemTypeId\":\"1\"}",
                "{\"itemName\":\"우산\",\"itemTypeId\":\"9223372036854775808\"}",
                "{\"itemName\":\"우산\",\"itemTypeId\":\"1\",\"status\":\"RENTED\"}"}) {
            mvc.perform(post("/api/v1/items").cookie(cookie("admin")).contentType("application/json").content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        verifyNoInteractions(items);
    }

    @Test
    void deniesAnonymousMembersAndCrossSiteWrites() throws Exception {
        String body = "{\"itemName\":\"우산\",\"itemTypeId\":\"1\"}";
        mvc.perform(post("/api/v1/items").contentType("application/json").content(body))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/items").cookie(cookie("user")).contentType("application/json").content(body))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/items").cookie(cookie("admin")).header("Origin", "https://other.example")
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        verifyNoInteractions(items);
    }

    @Test
    void returnsMissingTypeError() throws Exception {
        when(items.create(any())).thenThrow(new ItemException());
        mvc.perform(post("/api/v1/items").cookie(cookie("admin")).contentType("application/json")
                .content("{\"itemName\":\"우산\",\"itemTypeId\":\"99\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("ITEM_TYPE_NOT_FOUND"));
    }

    private Cookie cookie(String value) { return new Cookie(AuthCookies.SESSION_COOKIE, value); }
}
