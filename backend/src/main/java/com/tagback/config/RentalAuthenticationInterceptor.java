package com.tagback.config;

import com.tagback.exception.RentalException;
import com.tagback.service.RentalCodeService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
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
        if (!(handler instanceof HandlerMethod method) || !method.hasMethodAnnotation(RentalAuthenticated.class)) return true;
        if (method.hasMethodAnnotation(AdminOnly.class)
                || AnnotatedElementUtils.hasAnnotation(method.getBeanType(), AdminOnly.class)) return true;
        response.setHeader("Cache-Control", "no-store");
        String token = RentalHeaders.bearer(request);
        var service = codes.getIfAvailable();
        if (service == null) throw RentalException.grantInvalid();
        request.setAttribute(ATTRIBUTE, service.authenticate(token));
        return true;
    }
}
