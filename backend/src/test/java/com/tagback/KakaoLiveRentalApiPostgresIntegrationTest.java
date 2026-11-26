package com.tagback;

import com.tagback.controller.*;
import com.tagback.service.*;
import com.tagback.service.AuthSecrets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.annotation.DirtiesContext;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Deliberately activate mock profiles too: production must still expose no mock beans or routes. */
@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
@SpringBootTest(properties = {"spring.profiles.active=prod,kakao-live,sms-mock,kakao-auth,kakao-skill-probe",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "tagback.auth.common-hash-key=live-test-only-common-key-at-least-32-characters",
        "tagback.auth.allowed-origins=https://tagback.example",
        "tagback.kakao.hmac-key=live-test-only-hmac-key-at-least-32-characters",
        "tagback.kakao.skill-secret=live-test-only-header-key-at-least-32-characters",
        "tagback.kakao.bot-id=test-bot",
        "tagback.nfc.scan-secret=test-only-nfc-scan-secret-32-bytes-long",
        "tagback.nfc.bridge-id=kiosk-1", "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class KakaoLiveRentalApiPostgresIntegrationTest extends RentalApiPostgresIntegrationTest {
    @Autowired ApplicationContext context;

    @Test void productionExposesKakaoAndRentalsWithoutSmsOrProbeRoutes() throws Exception {
        assertNotNull(context.getBean(KakaoChallengeService.class));
        assertNotNull(context.getBean(LoginService.class));
        assertNotNull(context.getBean(RentalCodeService.class));
        assertTrue(context.getBeansOfType(KakaoSkillProbeController.class).isEmpty());
        assertTrue(context.getBeansOfType(KakaoIdentityProbeController.class).isEmpty());
        mvc.perform(post("/api/v1/dev/kakao/skill-probe").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/dev/kakao/identity-probe").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/auth/sms/requests").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/auth/sms/verifications").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/dev/sms/requests/00000000-0000-0000-0000-000000000000"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/auth/login/phone").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/auth/kakao/challenges").header("Origin", "https://untrusted.example")
                .contentType("application/json").content("{\"purpose\":\"SIGNUP\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/auth/kakao/challenges").header("Origin", "https://tagback.example")
                .contentType("application/json").content("{\"purpose\":\"SIGNUP\"}"))
                .andExpect(status().isCreated());
    }
}
