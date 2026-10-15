package com.tagback.nfc.bridge;

import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class BridgeConfigTest {
    @Test
    void commandLineOverridesEnvironmentAndNormalizesMockUid() {
        BridgeConfig config = BridgeConfig.parse(new String[] {
                "--port=8766", "--origin=http://127.0.0.1:5174", "--mock-uid=04:c8:ab:82:49:24:90"
        }, Map.of("NFC_BRIDGE_PORT", "8765", "NFC_BRIDGE_ORIGIN", "http://localhost:5173"));
        assertEquals(8766, config.port());
        assertEquals("http://127.0.0.1:5174", config.origin());
        assertEquals("04C8AB82492490", config.mockUid());
        assertEquals(2, config.emptyPollsToRemove());
        assertEquals(15_000, config.pingMillis());
    }

    @Test
    void configuresRemovalThresholdAndHeartbeat() {
        BridgeConfig config = BridgeConfig.parse(new String[] {"--remove-after=3", "--ping-ms=250"},
                Map.of("NFC_BRIDGE_REMOVE_AFTER", "4", "NFC_BRIDGE_PING_MS", "500"));
        assertEquals(3, config.emptyPollsToRemove());
        assertEquals(250, config.pingMillis());
        assertThrows(IllegalArgumentException.class,
                () -> BridgeConfig.parse(new String[] {"--remove-after=0"}, Map.of()));
    }

    @Test
    void rejectsWildcardOriginAndInvalidPort() {
        assertThrows(IllegalArgumentException.class,
                () -> BridgeConfig.parse(new String[] {"--origin=*"}, Map.of()));
        assertThrows(IllegalArgumentException.class,
                () -> BridgeConfig.parse(new String[] {"--port=0"}, Map.of()));
    }
}
