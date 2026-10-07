package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import java.util.Objects;
import com.tagback.dto.auth.SmsPurpose;

@Entity
@Table(name = "browser_registrations")
public class BrowserRegistration {
    @Id
    @Column(name = "browser_registration_id")
    private UUID id = UUID.randomUUID();

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "registration_token_hash", nullable = false, unique = true, length = 255)
    private String registrationTokenHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "last_used_at", nullable = false)
    private Instant lastUsedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected BrowserRegistration() {}

    public BrowserRegistration(User user, String registrationTokenHash, Instant expiresAt, Instant createdAt) {
        this.user = Objects.requireNonNull(user, "user");
        this.registrationTokenHash = Objects.requireNonNull(registrationTokenHash, "registrationTokenHash");
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.lastUsedAt = createdAt;
    }

    public UUID getId() { return id; }
    public User getUser() { return user; }
    public String getRegistrationTokenHash() { return registrationTokenHash; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getLastUsedAt() { return lastUsedAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public Instant getCreatedAt() { return createdAt; }

    public void renew(Instant now, Instant expiresAt) {
        this.lastUsedAt = Objects.requireNonNull(now);
        this.expiresAt = Objects.requireNonNull(expiresAt);
    }

    public void revoke(Instant now) {
        if (revokedAt == null) revokedAt = Objects.requireNonNull(now);
    }
}

