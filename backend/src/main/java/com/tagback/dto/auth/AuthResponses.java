package com.tagback.dto.auth;

import java.time.Instant;

/** Instant fields serialize as UTC ISO 8601 with the application's default JSON mapper. */
public final class AuthResponses {
    private AuthResponses() {}

    // String IDs keep the API independent of the BIGINT database representation.
    public record UserSummary(String userId, String maskedPhoneNumber, String role,
                              String name, String occupation) {}
    public record SessionStatus(boolean authenticated, UserSummary user, Instant sessionExpiresAt) {}
}
