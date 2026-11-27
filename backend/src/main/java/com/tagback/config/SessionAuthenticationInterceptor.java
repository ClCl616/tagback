package com.tagback.config;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

public class SessionAuthenticationInterceptor implements HandlerInterceptor {
    private final ObjectProvider<SessionService> sessions;
    private final com.tagback.service.AdminSessionService admins;
    public SessionAuthenticationInterceptor(ObjectProvider<SessionService> sessions, com.tagback.service.AdminSessionService admins) {
        this.sessions = sessions; this.admins = admins;
    }

    public SessionAuthenticationInterceptor(ObjectProvider<SessionService> sessions) {
        this.sessions = sessions; this.admins = null;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        boolean adminOnly = method.hasMethodAnnotation(AdminOnly.class)
                || AnnotatedElementUtils.hasAnnotation(method.getBeanType(), AdminOnly.class);
        boolean adminRead = method.hasMethodAnnotation(AdminReadable.class);
        boolean kioskAdmin = request.getRequestURI().startsWith("/api/v1/kiosk/admin/");
        if (adminOnly || (adminRead && AdminCredentials.cookie(request) != null)) {
            response.setHeader("Cache-Control", "no-store");
            if (adminOnly && !kioskAdmin && AdminCredentials.cookie(request) == null) {
                String userToken = null;
                if (request.getCookies() != null) for (var cookie : request.getCookies()) {
                    if (AuthCookies.SESSION_COOKIE.equals(cookie.getName())) {
                        if (userToken != null) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
                        userToken = cookie.getValue();
                    }
                }
                if (userToken != null && sessions.getIfAvailable() != null) {
                    sessions.getObject().authenticate(userToken);
                    // Even an account with the legacy ADMIN role cannot grant shared-password access.
                    throw new AuthException(AuthErrorCode.FORBIDDEN);
                }
            }
            if (admins == null) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
            var principal = admins.authenticate(kioskAdmin ? AdminCredentials.bearer(request) : AdminCredentials.cookie(request),
                    kioskAdmin ? "KIOSK" : "WEB");
            request.setAttribute(AdminPrincipal.ATTRIBUTE, principal);
            return true;
        }
        // A public marker must never override a method or controller's administrator restriction.
        if (!adminOnly && method.hasMethodAnnotation(PublicApi.class)) return true;
        // Rental authentication must already have succeeded in the preceding interceptor.
        if (!adminOnly && (method.hasMethodAnnotation(RentalAuthenticated.class)
                || method.hasMethodAnnotation(SessionOrRentalAuthenticated.class))
                && request.getAttribute(RentalAuthenticationInterceptor.ATTRIBUTE) != null) return true;
        response.setHeader("Cache-Control", "no-store");
        var service = sessions.getIfAvailable();
        // Protected handlers fail closed if no session service is available.
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
        request.setAttribute(AuthenticatedUser.ATTRIBUTE, user);
        return true;
    }
}
