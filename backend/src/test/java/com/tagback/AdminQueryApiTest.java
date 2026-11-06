package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.AdminQueryController;
import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.exception.*;
import com.tagback.service.AdminQueryService;
import com.tagback.service.SessionService;
import jakarta.servlet.http.Cookie;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Page;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(AdminQueryController.class)
@ActiveProfiles("sms-mock")
@Import({ApiAccessConfiguration.class, ApiExceptionHandler.class, AdminQueryService.class, AdminQueryApiTest.TimeConfig.class})
class AdminQueryApiTest {
    @TestConfiguration static class TimeConfig {
        @Bean Clock clock() { return Clock.fixed(Instant.parse("2026-11-05T03:00:00Z"), ZoneOffset.UTC); }
    }
    @Autowired MockMvc mvc;
    @MockitoBean SessionService sessions;
    @MockitoBean UserRepository users;
    @MockitoBean RentalRepository rentals;

    @BeforeEach void setup() {
        when(sessions.authenticate("admin")).thenReturn(new AuthenticatedUser(1L, UserRole.ADMIN));
        when(sessions.authenticate("member")).thenReturn(new AuthenticatedUser(2L, UserRole.USER));
        when(sessions.authenticate(null)).thenThrow(new AuthException(AuthErrorCode.SESSION_REQUIRED));
    }

    @Test void protectsBothLists() throws Exception {
        for (String path : List.of("/api/v1/admin/users", "/api/v1/admin/rentals")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).cookie(cookie("member"))).andExpect(status().isForbidden());
        }
        verifyNoInteractions(users, rentals);
    }

    @Test void returnsOnlySafeUserFieldsAndValidatesPagination() throws Exception {
        var user = mock(User.class);
        when(user.getId()).thenReturn(7L);
        when(user.getName()).thenReturn("홍길동");
        when(user.getRole()).thenReturn(UserRole.USER);
        when(users.findAll(any(Pageable.class))).thenReturn(new PageImpl<>(List.of(user)));
        mvc.perform(get("/api/v1/admin/users").cookie(cookie("admin")))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.users[0].userId").value("7"))
                .andExpect(jsonPath("$.users[0].phoneNumber").doesNotExist())
                .andExpect(jsonPath("$.users[0].pinHash").doesNotExist());
        mvc.perform(get("/api/v1/admin/users").cookie(cookie("admin")).param("size", "101"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
    }

    @Test void returnsRentalOwnerAndComputedOverdueStatus() throws Exception {
        var user = mock(User.class); var item = mock(Item.class); var type = mock(ItemType.class);
        var rental = mock(Rental.class);
        when(user.getId()).thenReturn(7L); when(user.getName()).thenReturn("홍길동");
        when(item.getId()).thenReturn(12L); when(item.getItemName()).thenReturn("우산");
        when(item.getItemType()).thenReturn(type); when(type.getId()).thenReturn(3L);
        when(type.getName()).thenReturn("생활용품");
        when(rental.getId()).thenReturn(101L); when(rental.getUser()).thenReturn(user);
        when(rental.getItem()).thenReturn(item);
        when(rental.getDueAt()).thenReturn(Instant.parse("2026-11-04T03:00:00Z"));
        when(rentals.findAll(any(Pageable.class))).thenReturn(new PageImpl<>(List.of(rental)));
        mvc.perform(get("/api/v1/admin/rentals").cookie(cookie("admin")))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.rentals[0].userId").value("7"))
                .andExpect(jsonPath("$.rentals[0].rentalStatus").value("OVERDUE"))
                .andExpect(jsonPath("$.rentals[0].overdue").value(true))
                .andExpect(jsonPath("$.rentals[0].returnCondition").hasJsonPath())
                .andExpect(jsonPath("$.rentals[0].returnCondition").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test void returnsRecordedReturnConditions() throws Exception {
        var user = mock(User.class); var item = mock(Item.class); var type = mock(ItemType.class);
        when(user.getId()).thenReturn(7L);
        when(item.getId()).thenReturn(12L); when(item.getItemType()).thenReturn(type);
        when(type.getId()).thenReturn(3L);
        var normal = mock(Rental.class); var damaged = mock(Rental.class); var legacy = mock(Rental.class);
        for (var rental : List.of(normal, damaged, legacy)) {
            when(rental.getId()).thenReturn(101L); when(rental.getUser()).thenReturn(user);
            when(rental.getItem()).thenReturn(item);
            when(rental.getDueAt()).thenReturn(Instant.parse("2026-11-04T03:00:00Z"));
            when(rental.getReturnedAt()).thenReturn(Instant.parse("2026-11-03T03:00:00Z"));
        }
        when(normal.getReturnCondition()).thenReturn(ReturnCondition.NORMAL);
        when(damaged.getReturnCondition()).thenReturn(ReturnCondition.DAMAGED);
        when(rentals.findAll(any(Pageable.class))).thenReturn(new PageImpl<>(List.of(normal, damaged, legacy)));
        mvc.perform(get("/api/v1/admin/rentals").cookie(cookie("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rentals[0].returnCondition").value("NORMAL"))
                .andExpect(jsonPath("$.rentals[1].returnCondition").value("DAMAGED"))
                .andExpect(jsonPath("$.rentals[2].returnCondition").hasJsonPath())
                .andExpect(jsonPath("$.rentals[2].returnCondition").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test void emptyPagesAndPaginationBoundaries() throws Exception {
        when(users.findAll(any(Pageable.class))).thenAnswer(inv -> Page.empty(inv.getArgument(0)));
        when(rentals.findAll(any(Pageable.class))).thenAnswer(inv -> Page.empty(inv.getArgument(0)));
        for (String path : List.of("/api/v1/admin/users", "/api/v1/admin/rentals")) {
            String field = path.endsWith("users") ? "users" : "rentals";
            mvc.perform(get(path).cookie(cookie("admin")).param("page", "2").param("size", "1"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$." + field).isEmpty())
                    .andExpect(jsonPath("$.page").value(2)).andExpect(jsonPath("$.totalElements").value(0));
            for (String[] params : new String[][] {{"page", "-1"}, {"size", "0"}, {"size", "101"},
                    {"page", "2147483647"}, {"page", "abc"}}) {
                mvc.perform(get(path).cookie(cookie("admin")).param(params[0], params[1]))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
            }
        }
    }
    private Cookie cookie(String token) { return new Cookie(AuthCookies.SESSION_COOKIE, token); }
}
