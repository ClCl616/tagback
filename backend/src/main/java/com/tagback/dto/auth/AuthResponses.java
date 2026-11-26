package com.tagback.dto.auth;

import java.time.Instant;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Instant fields serialize as UTC ISO 8601 with the application's default JSON mapper. */
public final class AuthResponses {
    private AuthResponses() {}

    public record PinResetResult(boolean completed) {}
    // String IDs keep the API independent of the BIGINT database representation.
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UserSummary(String userId, String role,
                              String name, String occupation) {}
    public record LoginResult(UserSummary user, Instant sessionExpiresAt,
                              Instant browserRegistrationExpiresAt) {}
    public record NewBrowserLoginResult(UserSummary user, Instant sessionExpiresAt,
                                        Instant browserRegistrationExpiresAt, boolean previousBrowserRevoked) {}
    public record BrowserStatus(boolean registered, Instant expiresAt) {}
    public record SessionStatus(boolean authenticated, UserSummary user, Instant sessionExpiresAt) {}
}
