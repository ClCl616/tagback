package com.tagback.config;

import com.tagback.service.SessionService;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class ApiAccessConfiguration implements WebMvcConfigurer {
    private final SessionAuthenticationInterceptor authentication;

    public ApiAccessConfiguration(ObjectProvider<SessionService> sessions) {
        authentication = new SessionAuthenticationInterceptor(sessions);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authentication).addPathPatterns("/api/**");
    }
}
