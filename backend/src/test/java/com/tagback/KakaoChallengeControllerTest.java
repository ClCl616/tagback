package com.tagback;

import com.tagback.config.AuthOriginGuard;
import com.tagback.controller.KakaoChallengeController;
import com.tagback.controller.KakaoLoginController;
import com.tagback.controller.KakaoPinResetController;
import com.tagback.service.KakaoLoginService;
import com.tagback.service.KakaoPinResetService;
import com.tagback.service.KakaoChallengeService;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KakaoChallengeControllerTest {
    @Test void cannotEnableExperimentalAuthInProductionProfiles() {
        for (String production : new String[]{"prod", "production"}) {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.getEnvironment().setActiveProfiles("kakao-auth", production);
                context.register(KakaoChallengeController.class, KakaoChallengeService.class, KakaoLoginController.class, KakaoLoginService.class,
                        KakaoPinResetController.class, KakaoPinResetService.class);
                context.refresh();
                assertTrue(context.getBeansOfType(KakaoChallengeController.class).isEmpty());
                assertTrue(context.getBeansOfType(KakaoChallengeService.class).isEmpty());
                assertTrue(context.getBeansOfType(KakaoLoginController.class).isEmpty());
                assertTrue(context.getBeansOfType(KakaoLoginService.class).isEmpty());
                assertTrue(context.getBeansOfType(KakaoPinResetController.class).isEmpty());
                assertTrue(context.getBeansOfType(KakaoPinResetService.class).isEmpty());
            }
        }
    }
    @Test void issuesHttpOnlyProofAndRejectsMissingOrDuplicateSkillSecrets() throws Exception {
        var service = mock(KakaoChallengeService.class);
        var secret = "development-test-only-header-key-at-least-32-characters";
        var proof = "a".repeat(43);
        when(service.newProof()).thenReturn(proof);
        when(service.issue(eq("SIGNUP"), eq(proof), anyString())).thenReturn(
                new KakaoChallengeService.Issued(UUID.randomUUID(), "0123456789", Instant.parse("2030-01-01T00:05:00Z")));
        var mvc = MockMvcBuilders.standaloneSetup(new KakaoChallengeController(service, new AuthOriginGuard(""), secret)).build();
        mvc.perform(post("/api/v1/auth/kakao/challenges").contentType(MediaType.APPLICATION_JSON)
                .content("{\"purpose\":\"SIGNUP\"}"))
                .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Set-Cookie", containsString("HttpOnly")))
                .andExpect(header().string("Set-Cookie", containsString("Secure")))
                .andExpect(jsonPath("$.code").value("0123456789"));
        var request = post("/api/v1/auth/kakao/skill").contentType(MediaType.APPLICATION_JSON).content("{}");
        mvc.perform(request).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/auth/kakao/skill").contentType(MediaType.APPLICATION_JSON)
                .header("X-Tagback-Skill-Secret", secret, secret).content("{}"))
                .andExpect(status().isForbidden());
        verify(service, never()).verify(anyMap(), anyString());
    }
}
