package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import java.util.Objects;
import com.tagback.dto.auth.SmsPurpose;

@Entity
@Table(name = "sms_verifications")
public class SmsVerification {
    @Id
    @Column(name = "sms_verification_id")
    private UUID id = UUID.randomUUID();

    @Column(name = "phone_number", nullable = false, length = 20)
    private String phoneNumber;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SmsPurpose purpose;

    @Column(name = "code_hash", nullable = false, length = 255)
    private String codeHash;

    @Column(name = "failed_count", nullable = false)
    private int failedCount;

    @Enumerated(EnumType.STRING)
    @Column(name = "delivery_status", nullable = false, length = 20)
    private SmsDeliveryStatus deliveryStatus = SmsDeliveryStatus.PENDING;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "resend_available_at", nullable = false)
    private Instant resendAvailableAt;

    @Column(name = "verified_at")
    private Instant verifiedAt;

    @Column(name = "invalidated_at")
    private Instant invalidatedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected SmsVerification() {}

    public SmsVerification(String phoneNumber, SmsPurpose purpose, String codeHash, Instant expiresAt, Instant resendAvailableAt, Instant createdAt) {
        this(UUID.randomUUID(), phoneNumber, purpose, codeHash, expiresAt, resendAvailableAt, createdAt);
    }

    public SmsVerification(UUID id, String phoneNumber, SmsPurpose purpose, String codeHash, Instant expiresAt, Instant resendAvailableAt, Instant createdAt) {
        this.id = Objects.requireNonNull(id);
        this.phoneNumber = Objects.requireNonNull(phoneNumber, "phoneNumber");
        this.purpose = Objects.requireNonNull(purpose, "purpose");
        this.codeHash = Objects.requireNonNull(codeHash, "codeHash");
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
        this.resendAvailableAt = Objects.requireNonNull(resendAvailableAt, "resendAvailableAt");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public UUID getId() { return id; }
    public String getPhoneNumber() { return phoneNumber; }
    public SmsPurpose getPurpose() { return purpose; }
    public String getCodeHash() { return codeHash; }
    public int getFailedCount() { return failedCount; }
    public SmsDeliveryStatus getDeliveryStatus() { return deliveryStatus; }
    public Instant getSentAt() { return sentAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getResendAvailableAt() { return resendAvailableAt; }
    public Instant getVerifiedAt() { return verifiedAt; }
    public Instant getInvalidatedAt() { return invalidatedAt; }
    public Instant getCreatedAt() { return createdAt; }

    public void markSent(Instant sentAt) {
        this.deliveryStatus = SmsDeliveryStatus.SENT;
        this.sentAt = Objects.requireNonNull(sentAt);
    }

    public void recordFailedAttempt() {
        if (failedCount < 5) failedCount++;
    }

    public void markVerified(Instant verifiedAt) {
        this.verifiedAt = Objects.requireNonNull(verifiedAt);
    }
}

