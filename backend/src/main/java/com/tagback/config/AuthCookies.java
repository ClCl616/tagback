package com.tagback.config;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
public class AuthCookies {
    public static final String SESSION_COOKIE = "__Host-tagback-session";
    public static final String BROWSER_COOKIE = "__Host-tagback-browser";
    private final Clock clock;
    public AuthCookies(Clock clock) { this.clock = clock; }

    public String[] issue(String browserToken, String sessionToken, Instant browserExpiry, Instant sessionAbsoluteExpiry) {
        Instant now = clock.instant();
        return new String[]{cookie(SESSION_COOKIE, sessionToken, Duration.between(now, sessionAbsoluteExpiry)),
                cookie(BROWSER_COOKIE, browserToken, Duration.between(now, browserExpiry))};
    }

    public String clearSession() { return cookie(SESSION_COOKIE, "", Duration.ZERO); }
    public String[] clearAll() { return new String[]{clearSession(), cookie(BROWSER_COOKIE, "", Duration.ZERO)}; }

    private String cookie(String name, String token, Duration maxAge) {
        return ResponseCookie.from(name, token).path("/").httpOnly(true).secure(true).sameSite("Lax").maxAge(maxAge).build().toString();
    }
}
