package com.tagback.controller;

import com.tagback.config.AuthOriginGuard;
import com.tagback.config.PublicApi;
import com.tagback.config.AuthCookies;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.service.SignupService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/auth")
public class SignupController {
    public static final String SESSION_COOKIE = AuthCookies.SESSION_COOKIE;
    public static final String BROWSER_COOKIE = AuthCookies.BROWSER_COOKIE;
    private final SignupService service;
    private final AuthOriginGuard originGuard;
    private final AuthCookies cookies;
    public SignupController(SignupService service, AuthOriginGuard originGuard, AuthCookies cookies) {
        this.service = service; this.originGuard = originGuard; this.cookies = cookies;
    }

    @PostMapping("/signup")
    @PublicApi
    public ResponseEntity<AuthResponses.LoginResult> signup(@Valid @RequestBody AuthRequests.Signup input,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        originGuard.check(request);
        var result = service.signup(input, key);
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE,
                        cookies.issue(result.browserToken(), result.sessionToken(), result.response().browserRegistrationExpiresAt(), result.sessionAbsoluteExpiry()))
                .body(result.response());
    }

}
