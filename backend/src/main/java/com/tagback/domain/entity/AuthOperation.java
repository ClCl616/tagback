package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import java.util.Objects;
import com.tagback.dto.auth.SmsPurpose;

@Entity
@Table(name = "auth_operations")
public class AuthOperation {
    @Id
    @Column(name = "operation_id")
    private UUID id = UUID.randomUUID();

    @Column(name = "caller_scope_hash", nullable = false, length = 255)
    private String callerScopeHash;

    @Column(name = "operation_type", nullable = false, length = 40)
    private String operationType;

    @Column(name = "idempotency_key", nullable = false, length = 128)
    private String idempotencyKey;

    @Column(name = "request_fingerprint", nullable = false, length = 255)
    private String requestFingerprint;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AuthOperationStatus status = AuthOperationStatus.PROCESSING;

    @Column(name = "result_json", columnDefinition = "text")
    private String resultJson;

    @Column(name = "error_code", length = 80)
    private String errorCode;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected AuthOperation() {}

    public AuthOperation(String callerScopeHash, String operationType, String idempotencyKey, String requestFingerprint, Instant expiresAt, Instant createdAt) {
        this.callerScopeHash = Objects.requireNonNull(callerScopeHash, "callerScopeHash");
        this.operationType = Objects.requireNonNull(operationType, "operationType");
        this.idempotencyKey = Objects.requireNonNull(idempotencyKey, "idempotencyKey");
        this.requestFingerprint = Objects.requireNonNull(requestFingerprint, "requestFingerprint");
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public UUID getId() { return id; }
    public String getCallerScopeHash() { return callerScopeHash; }
    public String getOperationType() { return operationType; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public AuthOperationStatus getStatus() { return status; }
    public String getResultJson() { return resultJson; }
    public String getErrorCode() { return errorCode; }
    public Instant getCompletedAt() { return completedAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getCreatedAt() { return createdAt; }

    public void completeSuccessfully(String resultJson, Instant completedAt) {
        this.status = AuthOperationStatus.SUCCEEDED;
        this.resultJson = Objects.requireNonNull(resultJson);
        this.completedAt = Objects.requireNonNull(completedAt);
    }

    public void completeFailed(String errorCode, String resultJson, Instant completedAt) {
        this.status = AuthOperationStatus.FAILED;
        this.errorCode = Objects.requireNonNull(errorCode);
        this.resultJson = Objects.requireNonNull(resultJson);
        this.completedAt = Objects.requireNonNull(completedAt);
    }
}

