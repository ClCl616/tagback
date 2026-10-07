package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import java.util.Objects;
import com.tagback.dto.auth.SmsPurpose;

@Entity
@Table(name = "verification_grants")
public class VerificationGrant {
    @Id
    @Column(name = "verification_grant_id")
    private UUID id = UUID.randomUUID();

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sms_verification_id", nullable = false, unique = true)
    private SmsVerification smsVerification;

    @Column(name = "phone_number", nullable = false, length = 20)
    private String phoneNumber;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SmsPurpose purpose;

    @Column(name = "token_hash", nullable = false, unique = true, length = 255)
    private String tokenHash;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected VerificationGrant() {}

    public VerificationGrant(SmsVerification smsVerification, String tokenHash, Instant expiresAt, Instant createdAt) {
        this.smsVerification = Objects.requireNonNull(smsVerification, "smsVerification");
        this.tokenHash = Objects.requireNonNull(tokenHash, "tokenHash");
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.phoneNumber = smsVerification.getPhoneNumber();
        this.purpose = smsVerification.getPurpose();
    }

    public UUID getId() { return id; }
    public SmsVerification getSmsVerification() { return smsVerification; }
    public String getPhoneNumber() { return phoneNumber; }
    public SmsPurpose getPurpose() { return purpose; }
    public String getTokenHash() { return tokenHash; }
    public Instant getConsumedAt() { return consumedAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getCreatedAt() { return createdAt; }
}

