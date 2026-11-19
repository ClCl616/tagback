package com.tagback.config;

import jakarta.servlet.http.HttpServletRequest;
import com.tagback.exception.*;
import java.util.Collections;

public final class AdminCredentials {
    public static final String COOKIE = "__Host-tagback-admin";
    private AdminCredentials() {}
    public static String cookie(HttpServletRequest request) {
        String token = null;
        if (request.getCookies() != null) for (var cookie : request.getCookies()) {
            if (COOKIE.equals(cookie.getName())) {
                if (token != null) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
                token = cookie.getValue();
            }
        }
        return token;
    }
    public static String bearer(HttpServletRequest request) {
        var values = Collections.list(request.getHeaders("Authorization"));
        if (values.size() != 1 || !values.getFirst().startsWith("Bearer "))
            throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
        return values.getFirst().substring(7);
    }
}
