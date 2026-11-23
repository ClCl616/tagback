package com.tagback.config;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;
import com.tagback.service.AuthSecrets;

@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class AuthConfiguration {
    @Bean
    public Clock authClock() {
        return Clock.systemUTC();
    }

    @Bean
    @Profile(AuthProfiles.COMMON_SECRETS)
    public AuthSecrets kakaoCommonAuthSecrets(@Value("${tagback.auth.common-hash-key:}") String key) {
        return new AuthSecrets(key);
    }
}
