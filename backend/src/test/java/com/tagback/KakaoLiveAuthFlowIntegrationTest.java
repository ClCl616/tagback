package com.tagback;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;

/** Repeat the full HTTP chatbot authentication flow under explicit live profiles. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=production,kakao-live,sms-mock,kakao-skill-probe",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "tagback.auth.common-hash-key=development-test-only-common-key-at-least-32-characters",
        "tagback.auth.allowed-origins=https://tagback.example",
        "tagback.kakao.hmac-key=development-test-only-hmac-key-at-least-32-characters",
        "tagback.kakao.skill-secret=development-test-only-header-key-at-least-32-characters",
        "tagback.kakao.bot-id=test-bot",
        "tagback.nfc.scan-secret=production-test-only-nfc-key-at-least-32-characters",
        "tagback.nfc.bridge-id=kiosk-1"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class KakaoLiveAuthFlowIntegrationTest extends KakaoAuthFlowIntegrationTest {}
