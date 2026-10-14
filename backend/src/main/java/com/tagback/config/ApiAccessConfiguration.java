package com.tagback.config;

import com.tagback.service.SessionService;
import com.tagback.service.RentalCodeService;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class ApiAccessConfiguration implements WebMvcConfigurer {
    private final SessionAuthenticationInterceptor authentication;
    private final RentalAuthenticationInterceptor rentalAuthentication;

    public ApiAccessConfiguration(ObjectProvider<SessionService> sessions, ObjectProvider<RentalCodeService> codes) {
        authentication = new SessionAuthenticationInterceptor(sessions);
        rentalAuthentication = new RentalAuthenticationInterceptor(codes);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(rentalAuthentication).addPathPatterns("/api/**");
        registry.addInterceptor(authentication).addPathPatterns("/api/**");
    }
}
