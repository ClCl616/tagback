package com.tagback.controller;

import com.tagback.config.AuthCookies;
import com.tagback.config.AuthOriginGuard;
import com.tagback.config.PublicApi;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.service.KakaoPinResetService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile(com.tagback.config.AuthProfiles.KAKAO)
@RequestMapping("/api/v1/auth/kakao/pin")
public class KakaoPinResetController {
    private final KakaoPinResetService service;
    private final AuthOriginGuard origins;
    private final AuthCookies cookies;

    public KakaoPinResetController(KakaoPinResetService service, AuthOriginGuard origins, AuthCookies cookies) {
        this.service = service; this.origins = origins; this.cookies = cookies;
    }

    @PublicApi @PostMapping("/reset")
    public ResponseEntity<AuthResponses.PinResetResult> reset(@Valid @RequestBody AuthRequests.KakaoPinReset input,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        origins.check(request);
        var result = service.reset(input, KakaoChallengeController.proof(request), key);
        var response = ResponseEntity.ok().cacheControl(CacheControl.noStore());
        // A later retry must not clear credentials issued by a subsequent login.
        if (!result.replayed()) response.header(HttpHeaders.SET_COOKIE, cookies.clearAll());
        return response.body(result.response());
    }
}
