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
        @DefaultValue("30m") @NotNull Duration sessionIdleTimeout,
        @DefaultValue("8h") @NotNull Duration sessionAbsoluteTimeout) {
    @AssertTrue(message="Session durations must be positive and idle timeout must not exceed absolute timeout")
    public boolean isDurationPolicyValid() {
        return sessionIdleTimeout != null && sessionAbsoluteTimeout != null
                && !sessionIdleTimeout.isNegative() && !sessionIdleTimeout.isZero()
                && !sessionAbsoluteTimeout.isNegative() && !sessionAbsoluteTimeout.isZero()
                && sessionIdleTimeout.compareTo(sessionAbsoluteTimeout) <= 0;
    }
}
