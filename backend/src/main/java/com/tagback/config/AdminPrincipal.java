package com.tagback.config;

import java.time.Instant;
import java.util.UUID;

/** A shared-password administrator is deliberately not a user account. */
public record AdminPrincipal(UUID sessionId, String channel, Instant expiresAt,
        String adminNumber, String name, boolean mustChangePassword) {
    public AdminPrincipal(UUID sessionId, String channel, Instant expiresAt) {
        this(sessionId, channel, expiresAt, "000", "대표 관리자", false);
    }
    public boolean representative() { return "000".equals(adminNumber); }
    public static final String ATTRIBUTE = "authenticatedAdmin";
}
