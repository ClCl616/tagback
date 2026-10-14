package com.tagback.config;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.domain.entity.UserRole;
import com.tagback.service.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

public class SessionAuthenticationInterceptor implements HandlerInterceptor {
    private final ObjectProvider<SessionService> sessions;

    public SessionAuthenticationInterceptor(ObjectProvider<SessionService> sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        boolean adminOnly = method.hasMethodAnnotation(AdminOnly.class)
                || AnnotatedElementUtils.hasAnnotation(method.getBeanType(), AdminOnly.class);
        // A public marker must never override a method or controller's administrator restriction.
        if (!adminOnly && method.hasMethodAnnotation(PublicApi.class)) return true;
        // Rental authentication must already have succeeded in the preceding interceptor.
        if (!adminOnly && (method.hasMethodAnnotation(RentalAuthenticated.class)
                || method.hasMethodAnnotation(SessionOrRentalAuthenticated.class))
                && request.getAttribute(RentalAuthenticationInterceptor.ATTRIBUTE) != null) return true;
        response.setHeader("Cache-Control", "no-store");
        var service = sessions.getIfAvailable();
        // Authentication is mock-profile-only for now. Protected handlers must fail closed elsewhere.
        if (service == null) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
        String token = null;
        if (request.getCookies() != null) {
            for (var cookie : request.getCookies()) {
                if (AuthCookies.SESSION_COOKIE.equals(cookie.getName())) {
                    // Reject ambiguous credentials rather than choosing a cookie arbitrarily.
                    if (token != null) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
                    token = cookie.getValue();
                }
            }
        }
        var user = service.authenticate(token);
        // Authenticate first: even administrator endpoints return 401 for invalid sessions.
        if (adminOnly && user.role() != UserRole.ADMIN) {
            throw new AuthException(AuthErrorCode.FORBIDDEN);
        }
        request.setAttribute(AuthenticatedUser.ATTRIBUTE, user);
        return true;
    }
}
