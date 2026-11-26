package com.tagback;

import com.tagback.controller.KakaoSkillProbeController;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class KakaoSkillProbeTest {
    private static final String PATH = "/api/v1/dev/kakao/skill-probe";
    private static final String SECRET = "test-only-secret-value-32-characters-long";
    private static final String HEADER = "X-Tagback-Skill-Secret";

    @Test void validatesSecretAndReturnsKakaoFormat() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new KakaoSkillProbeController(SECRET)).build();
        var valid = post(PATH).contentType(MediaType.APPLICATION_JSON).content("{\"userRequest\":{}}");
        mvc.perform(valid).andExpect(status().isForbidden());
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).header(HEADER, "wrong")
                .content("{\"userRequest\":{}}")) .andExpect(status().isForbidden());
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).header(HEADER, SECRET, SECRET)
                .content("{\"userRequest\":{}}")) .andExpect(status().isForbidden());
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).header(HEADER, SECRET)
                .content("{}")) .andExpect(status().isBadRequest());
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).header(HEADER, SECRET)
                .content("{\"userRequest\":{\"utterance\":\"123456\"}}"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.version").value("2.0"))
                .andExpect(jsonPath("$.template.outputs[0].simpleText.text").value("스킬 서버 연결을 확인했습니다."));
        var unconfigured = MockMvcBuilders.standaloneSetup(new KakaoSkillProbeController("")).build();
        unconfigured.perform(post(PATH).contentType(MediaType.APPLICATION_JSON).header(HEADER, SECRET)
                .content("{\"userRequest\":{}}")) .andExpect(status().isServiceUnavailable());
    }

    @Test void probeIsAbsentByDefaultAndInProduction() {
        for (String[] profiles : new String[][]{{}, {"kakao-skill-probe", "prod"},
                {"kakao-skill-probe", "production"}}) {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.getEnvironment().setActiveProfiles(profiles);
                context.register(KakaoSkillProbeController.class);
                context.refresh();
                assertTrue(context.getBeansOfType(KakaoSkillProbeController.class).isEmpty());
            }
        }
    }
}
