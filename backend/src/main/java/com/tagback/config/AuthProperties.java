package com.tagback.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.AssertTrue;

@Validated
@ConfigurationProperties("tagback.auth")
public record AuthProperties(
        @DefaultValue("24h") @NotNull Duration loginOperationTtl,
        @DefaultValue("30m") @NotNull Duration sessionIdleTimeout,
        @DefaultValue("8h") @NotNull Duration sessionAbsoluteTimeout,
        @DefaultValue("30d") @NotNull Duration browserRegistrationTtl,
        @DefaultValue("30s") @NotNull Duration pinFirstWait,
        @DefaultValue("1m") @NotNull Duration pinSecondWait,
        @DefaultValue("5m") @NotNull Duration pinThirdWait) {

    @AssertTrue(message = "Authentication durations must be positive and idle timeout must not exceed absolute timeout")
    public boolean isDurationPolicyValid() {
        Duration[] durations = {loginOperationTtl, sessionIdleTimeout, sessionAbsoluteTimeout,
                browserRegistrationTtl, pinFirstWait, pinSecondWait, pinThirdWait};
        for (Duration duration : durations) {
            if (duration == null || duration.isNegative() || duration.isZero()) return false;
        }
        return sessionIdleTimeout.compareTo(sessionAbsoluteTimeout) <= 0;
    }
}
