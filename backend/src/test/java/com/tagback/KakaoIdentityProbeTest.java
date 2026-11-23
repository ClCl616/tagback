package com.tagback;

import com.tagback.controller.KakaoIdentityProbeController;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.hamcrest.Matchers.*;

class KakaoIdentityProbeTest {
    @Test void protectsAndComparesWithoutExposingIdentifiers() throws Exception {
        var secret = "test-only-secret-value-32-characters-long";
        var mvc = MockMvcBuilders.standaloneSetup(new KakaoIdentityProbeController(secret)).build();
        var path = "/api/v1/dev/kakao/identity-probe";
        var body = "{\"userRequest\":{\"user\":{\"id\":\"sensitive-id\",\"type\":\"botUserKey\",\"properties\":{\"plusfriendUserKey\":\"private-value\"}}}}";
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).header("X-Tagback-Skill-Secret", secret).content(body))
                .andExpect(status().isOk()).andExpect(content().string(allOf(containsString("첫 요청"), containsString("plusfriendUserKey=있음"), not(containsString("sensitive-id")), not(containsString("private-value")))));
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).header("X-Tagback-Skill-Secret", secret).content(body))
                .andExpect(content().string(containsString("첫 요청과 일치")));
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).header("X-Tagback-Skill-Secret", secret).content(body.replace("sensitive-id", "another-id")))
                .andExpect(content().string(containsString("첫 요청과 다름")));
    }
}
