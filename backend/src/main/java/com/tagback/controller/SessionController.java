package com.tagback.controller;

import com.tagback.config.AuthCookies;
import com.tagback.config.AuthOriginGuard;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.service.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/auth")
public class SessionController {
    private final SessionService service;
    private final AuthCookies cookies;
    private final AuthOriginGuard origins;
    public SessionController(SessionService service, AuthCookies cookies, AuthOriginGuard origins) {
        this.service = service; this.cookies = cookies; this.origins = origins;
    }

    @GetMapping("/browser-registration")
    public ResponseEntity<AuthResponses.BrowserStatus> registration(
            @CookieValue(name = AuthCookies.BROWSER_COOKIE, required = false) String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.registration(token));
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
    public ResponseEntity<Void> logout(
            @CookieValue(name = AuthCookies.SESSION_COOKIE, required = false) String token, HttpServletRequest request) {
        origins.check(request);
        service.logout(token);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, cookies.clearSession()).build();
    }

    @DeleteMapping("/browser-registration")
    public ResponseEntity<Void> unregister(
            @CookieValue(name = AuthCookies.BROWSER_COOKIE, required = false) String browserToken,
            @CookieValue(name = AuthCookies.SESSION_COOKIE, required = false) String sessionToken, HttpServletRequest request) {
        origins.check(request);
        service.unregister(browserToken, sessionToken);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, cookies.clearAll()).build();
    }
}
