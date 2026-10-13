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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ItemController.class)
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, AuthOriginGuard.class})
class ItemDeleteApiTest {
    @Autowired MockMvc mvc;
    @MockitoBean ItemService items;
    @MockitoBean SessionService sessions;

    @BeforeEach void authenticate() {
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(1L, UserRole.ADMIN));
        when(sessions.authenticate("user")).thenReturn(new AuthenticatedUser(2L, UserRole.USER));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test void returns204WithNoBody() throws Exception {
        mvc.perform(delete("/api/v1/items/10").cookie(cookie("admin")))
                .andExpect(status().isNoContent()).andExpect(content().string(""));
        verify(items).delete(10L);
    }

    @Test void requiresAdminAndAllowedOrigin() throws Exception {
        mvc.perform(delete("/api/v1/items/10")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/v1/items/10").cookie(cookie("user"))).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/items/10").cookie(cookie("admin")).header("Origin", "https://other.example"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(items);
    }

    @Test void rejectsInvalidIdsBeforeDeleting() throws Exception {
        for (String id : List.of("0", "-1", "abc", "9223372036854775808")) {
            mvc.perform(delete("/api/v1/items/" + id).cookie(cookie("admin")))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
        }
        verifyNoInteractions(items);
    }

    @Test void returns404And409() throws Exception {
        for (ItemException failure : List.of(ItemException.itemNotFound(), ItemException.deleteConflict())) {
            doThrow(failure).when(items).delete(10L);
            mvc.perform(delete("/api/v1/items/10").cookie(cookie("admin")))
                    .andExpect(status().is(failure.status())).andExpect(jsonPath("$.error.code").value(failure.code()));
        }
    }

    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
}
