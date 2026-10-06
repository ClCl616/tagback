package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import java.util.Objects;
import com.tagback.dto.auth.SmsPurpose;

@Entity
@Table(name = "login_sessions")
public class LoginSession {
    @Id
    @Column(name = "login_session_id")
    private UUID id = UUID.randomUUID();

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "browser_registration_id", nullable = false)
    private BrowserRegistration browserRegistration;

    @Column(name = "session_token_hash", nullable = false, unique = true, length = 255)
    private String sessionTokenHash;

    @Column(name = "last_activity_at", nullable = false)
    private Instant lastActivityAt;

    @Column(name = "idle_expires_at", nullable = false)
    private Instant idleExpiresAt;

    @Column(name = "absolute_expires_at", nullable = false)
    private Instant absoluteExpiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "revoked_reason", length = 30)
    private SessionRevokedReason revokedReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected LoginSession() {}

    public LoginSession(BrowserRegistration browserRegistration, String sessionTokenHash, Instant idleExpiresAt, Instant absoluteExpiresAt, Instant createdAt) {
        this.browserRegistration = Objects.requireNonNull(browserRegistration, "browserRegistration");
        this.sessionTokenHash = Objects.requireNonNull(sessionTokenHash, "sessionTokenHash");
        this.idleExpiresAt = Objects.requireNonNull(idleExpiresAt, "idleExpiresAt");
        this.absoluteExpiresAt = Objects.requireNonNull(absoluteExpiresAt, "absoluteExpiresAt");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.user = browserRegistration.getUser();
        this.lastActivityAt = createdAt;
    }

    public UUID getId() { return id; }
    public User getUser() { return user; }
    public BrowserRegistration getBrowserRegistration() { return browserRegistration; }
    public String getSessionTokenHash() { return sessionTokenHash; }
    public Instant getLastActivityAt() { return lastActivityAt; }
    public Instant getIdleExpiresAt() { return idleExpiresAt; }
    public Instant getAbsoluteExpiresAt() { return absoluteExpiresAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public SessionRevokedReason getRevokedReason() { return revokedReason; }
    public Instant getCreatedAt() { return createdAt; }

    public void recordActivity(Instant now, Instant idleExpiresAt) {
        this.lastActivityAt = Objects.requireNonNull(now);
        this.idleExpiresAt = Objects.requireNonNull(idleExpiresAt);
    }

    public void revoke(Instant now, SessionRevokedReason reason) {
        if (revokedAt != null) return;
        this.revokedAt = Objects.requireNonNull(now);
        this.revokedReason = Objects.requireNonNull(reason);
    }
}

