package com.tagback.controller;

import com.tagback.config.AuthCookies;
import com.tagback.config.PublicApi;
import com.tagback.config.AuthOriginGuard;
import com.tagback.dto.auth.*;
import com.tagback.service.LoginService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/auth/login")
public class LoginController {
    private final LoginService service;
    private final AuthOriginGuard origins;
    private final AuthCookies cookies;
    public LoginController(LoginService service, AuthOriginGuard origins, AuthCookies cookies) {
        this.service = service; this.origins = origins; this.cookies = cookies;
    }

    @PostMapping("/registered")
    @PublicApi
    public ResponseEntity<AuthResponses.LoginResult> registered(@Valid @RequestBody AuthRequests.RegisteredLogin input,
            @CookieValue(name = AuthCookies.BROWSER_COOKIE, required = false) String browserToken,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        origins.check(request);
        var result = service.registered(input, browserToken, key);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE,
                cookies.issue(result.browserToken(), result.sessionToken(), result.response().browserRegistrationExpiresAt(), result.sessionAbsoluteExpiry()))
                .body(result.response());
    }

    @PostMapping("/new-browser")
    @PublicApi
    public ResponseEntity<AuthResponses.NewBrowserLoginResult> newBrowser(@Valid @RequestBody AuthRequests.NewBrowserLogin input,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        origins.check(request);
        var result = service.newBrowser(input, key);
        var response = result.response();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE,
                cookies.issue(result.browserToken(), result.sessionToken(), response.browserRegistrationExpiresAt(), result.sessionAbsoluteExpiry()))
                .body(new AuthResponses.NewBrowserLoginResult(response.user(), response.sessionExpiresAt(),
                        response.browserRegistrationExpiresAt(), result.previousBrowserRevoked()));
    }
}
