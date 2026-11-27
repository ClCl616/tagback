package com.tagback;

import com.tagback.config.AuthProperties;

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
    void bindsPolicyDefaultsAndRejectsInvalidDurations() {
        var defaults = new Binder(new MapConfigurationPropertySource(Map.of("tagback.auth.session-idle-timeout", "30m")))
                .bind("tagback.auth", Bindable.of(AuthProperties.class)).get();
        assertEquals(Duration.ofHours(8), defaults.sessionAbsoluteTimeout());
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(defaults).isEmpty());
            var invalid = new Binder(new MapConfigurationPropertySource(Map.of("tagback.auth.session-idle-timeout", "0s")))
                    .bind("tagback.auth", Bindable.of(AuthProperties.class)).get();
            assertFalse(factory.getValidator().validate(invalid).isEmpty());
        }
    }
}
