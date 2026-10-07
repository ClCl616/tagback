package com.tagback.dto.auth;

import java.time.Instant;

/** Instant fields serialize as UTC ISO 8601 with the application's default JSON mapper. */
public final class AuthResponses {
    private AuthResponses() {}

    public record SmsRequested(String requestId, Instant expiresAt, Instant resendAvailableAt) {}
    public record SmsVerified(String verificationToken, SmsPurpose purpose,
                              Instant expiresAt, String maskedPhoneNumber) {
        @Override public String toString() { return "SmsVerified[redacted]"; }
    }
    public record PinResetResult(boolean completed) {}
    // String IDs keep the API independent of the BIGINT database representation.
    public record UserSummary(String userId, String maskedPhoneNumber, String role,
                              String name, String occupation) {}
    public record LoginResult(UserSummary user, Instant sessionExpiresAt,
                              Instant browserRegistrationExpiresAt) {}
    public record NewBrowserLoginResult(UserSummary user, Instant sessionExpiresAt,
                                        Instant browserRegistrationExpiresAt, boolean previousBrowserRevoked) {}
    public record BrowserStatus(boolean registered, String maskedPhoneNumber, Instant expiresAt) {}
    public record SessionStatus(boolean authenticated, UserSummary user, Instant sessionExpiresAt) {}
}
