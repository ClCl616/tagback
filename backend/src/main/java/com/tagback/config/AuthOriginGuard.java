package com.tagback.config;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Browser origin checks for endpoints that issue authentication cookies. */
@Component
public class AuthOriginGuard {
    private final Set<String> allowedOrigins;
    public AuthOriginGuard(@Value("${tagback.auth.allowed-origins:}") String origins) {
        allowedOrigins = Arrays.stream(origins.split(",")).map(String::trim).filter(value -> !value.isEmpty()).collect(Collectors.toUnmodifiableSet());
    }

    public void check(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null) {
            if (allowedOrigins.contains(origin)) return;
            try {
                URI source = URI.create(origin);
                URI target = URI.create(request.getRequestURL().toString());
                if (source.getRawQuery() == null && source.getRawFragment() == null && source.getRawUserInfo() == null
                        && (source.getRawPath() == null || source.getRawPath().isEmpty())
                        && target.getScheme().equalsIgnoreCase(source.getScheme())
                        && target.getHost().equalsIgnoreCase(source.getHost()) && port(source) == port(target)) return;
            } catch (IllegalArgumentException | NullPointerException ignored) { }
            throw new AuthException(AuthErrorCode.FORBIDDEN);
        }
        if ("cross-site".equals(request.getHeader("Sec-Fetch-Site"))) throw new AuthException(AuthErrorCode.FORBIDDEN);
    }

    private int port(URI uri) { return uri.getPort() >= 0 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80); }
}
