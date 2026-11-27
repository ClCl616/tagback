package com.tagback.controller;

import com.tagback.config.AuthCookies;
import com.tagback.config.PublicApi;
import com.tagback.config.AuthOriginGuard;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.service.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class SessionController {
    private final SessionService service;
    private final com.tagback.service.KakaoOAuthService oauth;
    private final AuthCookies cookies;
    private final AuthOriginGuard origins;
    public SessionController(SessionService service, AuthCookies cookies, AuthOriginGuard origins, com.tagback.service.KakaoOAuthService oauth) {
        this.oauth = oauth; this.service = service; this.cookies = cookies; this.origins = origins;
    }

    @GetMapping("/session")
    public ResponseEntity<AuthResponses.SessionStatus> session(
            @CookieValue(name = AuthCookies.SESSION_COOKIE, required = false) String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.current(token));
    }

    @PostMapping("/session/activity")
    public ResponseEntity<AuthResponses.SessionStatus> activity(
            @CookieValue(name = AuthCookies.SESSION_COOKIE, required = false) String token, HttpServletRequest request) {
        origins.check(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.activity(token));
    }

    @PostMapping("/logout")
    @PublicApi
    public ResponseEntity<Void> logout(
            @CookieValue(name = AuthCookies.SESSION_COOKIE, required = false) String token, HttpServletRequest request) {
        origins.check(request);
        service.logout(token);
        oauth.invalidate(KakaoOAuthController.cookie(request,KakaoOAuthController.FLOW));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, cookies.clearAll())
                .header(HttpHeaders.SET_COOKIE, KakaoOAuthController.flowCookie("",0)).build();
    }

}
