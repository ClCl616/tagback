package com.tagback;

import com.tagback.config.KakaoLiveConfiguration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import static org.junit.jupiter.api.Assertions.*;

class KakaoLiveConfigurationTest {
    private static final String COMMON = "test-common-secret-at-least-32-characters";
    private static final String HMAC = "test-kakao-hmac-secret-at-least-32-characters";
    private static final String SKILL = "test-skill-secret-at-least-32-characters";
    private static final String NFC = "test-nfc-secret-at-least-32-characters";
    private void configure(String common, String hmac, String skill, String origins, String nfc, String bridge) {
        new KakaoLiveConfiguration(common, hmac, skill, "bot-id", origins, nfc, bridge);
    }
    @Test void liveRequiresExplicitDistinctSecretsAndHttpsOrigins() {
        assertDoesNotThrow(() -> configure(COMMON, HMAC, SKILL, "https://tagback.example,https://admin.tagback.example:8443", NFC, "kiosk-1"));
        assertThrows(IllegalStateException.class, () -> configure("", HMAC, SKILL, "https://tagback.example", NFC, "kiosk-1"));
        assertThrows(IllegalStateException.class, () -> configure(COMMON, COMMON, SKILL, "https://tagback.example", NFC, "kiosk-1"));
        assertThrows(IllegalStateException.class, () -> configure(COMMON, HMAC, SKILL, "", NFC, "kiosk-1"));
        assertThrows(IllegalStateException.class, () -> configure(COMMON, HMAC, SKILL, "http://tagback.example", NFC, "kiosk-1"));
        assertThrows(IllegalStateException.class, () -> configure(COMMON, HMAC, SKILL, "https://tagback.example/path", NFC, "kiosk-1"));
        assertThrows(IllegalStateException.class, () -> configure(COMMON, HMAC, SKILL, "https://tagback.example:99999", NFC, "kiosk-1"));
        assertThrows(IllegalStateException.class, () -> configure(COMMON, HMAC, SKILL, "https://tagback.example", NFC, ""));
    }

    @Test void liveSpringContextFailsWithoutRequiredConfiguration() {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("prod", "kakao-live");
            context.register(KakaoLiveConfiguration.class);
            assertThrows(Exception.class, context::refresh);
        }
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("production", "kakao-live");
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("live-test", Map.of(
                    "tagback.auth.common-hash-key", COMMON, "tagback.kakao.hmac-key", HMAC,
                    "tagback.kakao.skill-secret", SKILL, "tagback.kakao.bot-id", "bot-id",
                    "tagback.auth.allowed-origins", "https://tagback.example",
                    "tagback.nfc.scan-secret", NFC, "tagback.nfc.bridge-id", "kiosk-1")));
            context.register(KakaoLiveConfiguration.class);
            assertDoesNotThrow(context::refresh);
            assertNotNull(context.getBean(KakaoLiveConfiguration.class));
        }
    }
}
