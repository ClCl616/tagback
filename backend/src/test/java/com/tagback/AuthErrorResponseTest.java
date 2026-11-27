package com.tagback;

import com.tagback.controller.KakaoOAuthController;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import jakarta.validation.Valid;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

class AuthErrorResponseTest {
    @RestController
    static class TestController {
        @PostMapping("/test/profile")
        public void pin(@Valid @RequestBody KakaoOAuthController.Profile request) {
            throw new AuthException(AuthErrorCode.ADMIN_LOGIN_LIMITED, Instant.parse("2026-10-06T09:00:30Z"));
        }
    }

    @Test
    void returnsStableErrorAndUtcRetryTime() throws Exception {
        standaloneSetup(new TestController()).setControllerAdvice(new ApiExceptionHandler()).build()
                .perform(post("/test/profile").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"test\",\"occupation\":\"학생\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("ADMIN_LOGIN_LIMITED"))
                .andExpect(jsonPath("$.error.retryAt").value("2026-10-06T09:00:30Z"));
    }

    @Test
    void invalidAndMalformedRequestsReturnSanitizedErrors() throws Exception {
        var mvc = standaloneSetup(new TestController()).setControllerAdvice(new ApiExceptionHandler()).build();
        for (String body : new String[]{"{\"name\":\"secret\"}", "{", "{}"}) {
            mvc.perform(post("/test/profile").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_INPUT"))
                    .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("secret"))));
        }
    }
}
