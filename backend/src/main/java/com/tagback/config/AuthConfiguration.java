package com.tagback.config;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class AuthConfiguration {
    @Bean
    public Clock authClock() {
        return Clock.systemUTC();
    }
}
