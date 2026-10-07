package com.tagback;

import com.tagback.service.PinService;
import com.tagback.exception.AuthException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PinServiceTest {
    @Test void validatesPatternsAndHashesLeadingZeroPin() {
        var pins = new PinService();
        for (String invalid : new String[]{"123456", "654321", "789012", "210987", "000123", "041888", "12345", "abcdef"}) {
            assertThrows(AuthException.class, () -> pins.validate(invalid));
        }
        for (String valid : new String[]{"041527", "001527", "551204"}) pins.validate(valid);
        String hash = pins.hash("041527");
        assertNotEquals("041527", hash);
        assertTrue(pins.matches("041527", hash));
        assertFalse(pins.matches("041528", hash));
        assertFalse(pins.matches("041527", "legacy-password-hash"));
    }
}
