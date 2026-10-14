package com.tagback.config;

import com.tagback.exception.RentalException;
import com.tagback.service.RentalCodeService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Collections;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

public class RentalAuthenticationInterceptor implements HandlerInterceptor {
    public static final String ATTRIBUTE = "authenticatedRentalGrant";
    private final ObjectProvider<RentalCodeService> codes;
    public RentalAuthenticationInterceptor(ObjectProvider<RentalCodeService> codes) { this.codes = codes; }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) return true;
        boolean rentalOnly = method.hasMethodAnnotation(RentalAuthenticated.class);
        boolean rentalOrSession = method.hasMethodAnnotation(SessionOrRentalAuthenticated.class);
        if (!rentalOnly && !rentalOrSession) return true;
        if (method.hasMethodAnnotation(AdminOnly.class)
                || AnnotatedElementUtils.hasAnnotation(method.getBeanType(), AdminOnly.class)) return true;
        // On a dual-auth endpoint, no Authorization header selects normal session authentication.
        // An explicitly supplied but invalid header must not fall back to a cookie.
        if (rentalOrSession && !rentalOnly && Collections.list(request.getHeaders("Authorization")).isEmpty()) return true;
        response.setHeader("Cache-Control", "no-store");
        String token = RentalHeaders.bearer(request);
        var service = codes.getIfAvailable();
        if (service == null) throw RentalException.grantInvalid();
        request.setAttribute(ATTRIBUTE, service.authenticate(token));
        return true;
    }
}
