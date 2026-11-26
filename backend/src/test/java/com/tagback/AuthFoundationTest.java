package com.tagback;

import com.tagback.config.AuthProperties;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.domain.entity.User;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class AuthFoundationTest {
    @Test
    void oldStoredLoginUserCanBeReplayedWithoutReturningPhone() {
        var json = new tools.jackson.databind.ObjectMapper();
        var user = json.readValue("{\"userId\":\"7\",\"maskedPhoneNumber\":\"010-****-1234\",\"role\":\"USER\",\"name\":\"홍길동\",\"occupation\":\"학생\"}", AuthResponses.UserSummary.class);
        assertEquals("7", user.userId());
        assertFalse(json.writeValueAsString(user).contains("maskedPhoneNumber"));
    }
    @Test
    void supportsPhoneFreeUsers() {
        var user = User.withoutPhone("test-pin-hash", Instant.parse("2026-11-17T00:00:00Z"));
        assertNull(user.getPhoneNumber());
        assertThrows(NullPointerException.class, () -> User.withoutPhone(null, Instant.now()));
    }
    @Test
    void validatesPinAsSixAsciiDigitsWithoutLosingLeadingZero() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertTrue(validator.validate(new AuthRequests.RegisteredLogin("041527")).isEmpty());
            String[] invalid = {null, "", "41527", "0415270", "abcdef", "０４１５２７"};
            for (String value : invalid) {
                assertFalse(validator.validate(new AuthRequests.RegisteredLogin(value)).isEmpty());
            }
            assertFalse(validator.validate(new AuthRequests.KakaoSignup(java.util.UUID.randomUUID(), "041527", new AuthRequests.Profile(" ", "학생"))).isEmpty());
            assertFalse(validator.validate(new AuthRequests.KakaoSignup(java.util.UUID.randomUUID(), "041527", null)).isEmpty());
        }
    }

    @Test
    void bindsPolicyDefaultsAndRejectsInvalidDurations() {
        var defaults = new Binder(new MapConfigurationPropertySource(Map.of("tagback.auth.login-operation-ttl", "24h")))
                .bind("tagback.auth", Bindable.of(AuthProperties.class)).get();
        assertEquals(Duration.ofDays(30), defaults.browserRegistrationTtl());
        assertEquals(Duration.ofHours(8), defaults.sessionAbsoluteTimeout());
        assertEquals(Duration.ofHours(24), defaults.loginOperationTtl());
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(defaults).isEmpty());
            var invalid = new Binder(new MapConfigurationPropertySource(Map.of("tagback.auth.login-operation-ttl", "0s")))
                    .bind("tagback.auth", Bindable.of(AuthProperties.class)).get();
            assertFalse(factory.getValidator().validate(invalid).isEmpty());
        }
    }
}
