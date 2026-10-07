package com.tagback;

import com.tagback.dto.auth.AuthRequests;
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
        @PostMapping("/test/pin")
        public void pin(@Valid @RequestBody AuthRequests.RegisteredLogin request) {
            throw new AuthException(AuthErrorCode.PIN_RETRY_WAIT, Instant.parse("2026-10-06T09:00:30Z"));
        }
    }

    @Test
    void returnsStableErrorAndUtcRetryTime() throws Exception {
        standaloneSetup(new TestController()).setControllerAdvice(new ApiExceptionHandler()).build()
                .perform(post("/test/pin").contentType(MediaType.APPLICATION_JSON).content("{\"pin\":\"041527\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("PIN_RETRY_WAIT"))
                .andExpect(jsonPath("$.error.retryAt").value("2026-10-06T09:00:30Z"));
    }

    @Test
    void invalidAndMalformedRequestsReturnSanitizedErrors() throws Exception {
        var mvc = standaloneSetup(new TestController()).setControllerAdvice(new ApiExceptionHandler()).build();
        for (String body : new String[]{"{\"pin\":\"secret\"}", "{", "{}"}) {
            mvc.perform(post("/test/pin").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_INPUT"))
                    .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("secret"))));
        }
    }
}
