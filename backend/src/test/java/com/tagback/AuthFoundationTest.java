package com.tagback;

import com.tagback.config.AuthProperties;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.PhoneNumberNormalizer;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import java.time.Duration;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class AuthFoundationTest {
    @Test
    void normalizesDomesticAndInternationalForms() {
        var normalizer = new PhoneNumberNormalizer();
        assertEquals("+821012345678", normalizer.normalize("010-1234-5678"));
        assertEquals("+821012345678", normalizer.normalize(" +82 10-1234-5678 "));
    }

    @Test
    void rejectsInvalidAndUnsupportedNumbers() {
        var normalizer = new PhoneNumberNormalizer();
        String[] invalid = {null, "", "0101234567", "010123456789", "abc01012345678", "+821012345678x", "0212345678"};
        for (String value : invalid) {
            assertEquals(AuthErrorCode.INVALID_INPUT,
                    assertThrows(AuthException.class, () -> normalizer.normalize(value)).code());
        }
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
            assertFalse(validator.validate(new AuthRequests.Signup("", "041527", new AuthRequests.Profile("테스트", "학생"))).isEmpty());
            assertFalse(validator.validate(new AuthRequests.Signup("token", "041527", new AuthRequests.Profile(" ", "학생"))).isEmpty());
            assertFalse(validator.validate(new AuthRequests.Signup("token", "041527", null)).isEmpty());
            assertFalse(validator.validate(new AuthRequests.SmsRequest("", null)).isEmpty());
        }
    }

    @Test
    void bindsPolicyDefaultsAndRejectsInvalidDurations() {
        var defaults = new Binder(new MapConfigurationPropertySource(Map.of("tagback.auth.sms-max-requests", "10")))
                .bind("tagback.auth", Bindable.of(AuthProperties.class)).get();
        assertEquals(Duration.ofMinutes(5), defaults.smsCodeTtl());
        assertEquals(Duration.ofDays(30), defaults.browserRegistrationTtl());
        assertEquals(Duration.ofHours(8), defaults.sessionAbsoluteTimeout());
        assertEquals(10, defaults.smsMaxRequests());
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(defaults).isEmpty());
            var invalid = new Binder(new MapConfigurationPropertySource(Map.of("tagback.auth.sms-code-ttl", "0s")))
                    .bind("tagback.auth", Bindable.of(AuthProperties.class)).get();
            assertFalse(factory.getValidator().validate(invalid).isEmpty());
        }
    }
}
