package com.tagback.config;

import java.time.Instant;
import java.util.UUID;

/** A shared-password administrator is deliberately not a user account. */
public record AdminPrincipal(UUID sessionId, String channel, Instant expiresAt) {
    public static final String ATTRIBUTE = "authenticatedAdmin";
}
