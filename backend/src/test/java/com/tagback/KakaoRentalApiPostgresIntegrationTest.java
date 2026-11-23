package com.tagback;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;

/** Run the same checkout and signed-return regression suite with phone-free Kakao users. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=kakao-auth",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "tagback.auth.common-hash-key=development-test-only-common-key-at-least-32-characters",
        "tagback.kakao.hmac-key=development-test-only-hmac-key-at-least-32-characters",
        "tagback.kakao.skill-secret=development-test-only-header-key-at-least-32-characters",
        "tagback.kakao.bot-id=test-bot",
        "tagback.nfc.scan-secret=test-only-nfc-scan-secret-32-bytes-long",
        "tagback.nfc.bridge-id=kiosk-1", "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class KakaoRentalApiPostgresIntegrationTest extends RentalApiPostgresIntegrationTest {}
