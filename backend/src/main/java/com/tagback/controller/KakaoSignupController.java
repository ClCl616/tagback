package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.dto.auth.*;
import com.tagback.service.KakaoSignupService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile(com.tagback.config.AuthProfiles.KAKAO)
@RequestMapping("/api/v1/auth/kakao")
public class KakaoSignupController {
    private final KakaoSignupService service;
    private final AuthOriginGuard origins;
    private final AuthCookies cookies;

    public KakaoSignupController(KakaoSignupService service, AuthOriginGuard origins, AuthCookies cookies) {
        this.service = service; this.origins = origins; this.cookies = cookies;
    }

    @PublicApi @PostMapping("/signup")
    public ResponseEntity<AuthResponses.LoginResult> signup(@Valid @RequestBody AuthRequests.KakaoSignup input,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        origins.check(request);
        var result = service.signup(input, KakaoChallengeController.proof(request), key);
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, cookies.issue(result.browserToken(), result.sessionToken(),
                        result.response().browserRegistrationExpiresAt(), result.sessionAbsoluteExpiry()))
                .body(result.response());
    }
}
