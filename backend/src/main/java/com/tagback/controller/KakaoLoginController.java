package com.tagback.controller;

import com.tagback.config.AuthCookies;
import com.tagback.config.AuthOriginGuard;
import com.tagback.config.PublicApi;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.service.KakaoLoginService;
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
@RequestMapping("/api/v1/auth/kakao")
public class KakaoLoginController {
    private final KakaoLoginService service;
    private final AuthOriginGuard origins;
    private final AuthCookies cookies;

    public KakaoLoginController(KakaoLoginService service, AuthOriginGuard origins, AuthCookies cookies) {
        this.service = service; this.origins = origins; this.cookies = cookies;
    }

    @PublicApi @PostMapping("/login/new-browser")
    public ResponseEntity<AuthResponses.NewBrowserLoginResult> newBrowser(
            @Valid @RequestBody AuthRequests.KakaoNewBrowserLogin input,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        origins.check(request);
        var result = service.newBrowser(input, KakaoChallengeController.proof(request), key);
        var response = result.response();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, cookies.issue(result.browserToken(), result.sessionToken(),
                        response.browserRegistrationExpiresAt(), result.sessionAbsoluteExpiry()))
                .body(new AuthResponses.NewBrowserLoginResult(response.user(), response.sessionExpiresAt(),
                        response.browserRegistrationExpiresAt(), result.previousBrowserRevoked()));
    }
}
