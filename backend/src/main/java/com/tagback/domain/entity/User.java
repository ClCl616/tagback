package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import java.util.Objects;
import com.tagback.dto.auth.SmsPurpose;

@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "user_id")
    private Long id;

    @Column(name = "phone_number", nullable = false, unique = true, length = 20)
    private String phoneNumber;

    @Column(name = "pin_hash", length = 255)
    private String pinHash;

    @Column(name = "name", length = 40)
    private String name;

    @Column(name = "occupation", length = 40)
    private String occupation;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserRole role = UserRole.USER;

    @Column(name = "pin_failed_count", nullable = false)
    private int pinFailedCount;

    @Column(name = "pin_locked_until")
    private Instant pinLockedUntil;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected User() {}

    public User(String phoneNumber, String pinHash, Instant createdAt) {
        this.phoneNumber = Objects.requireNonNull(phoneNumber, "phoneNumber");
        this.pinHash = Objects.requireNonNull(pinHash, "pinHash");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public Long getId() { return id; }
    public String getPhoneNumber() { return phoneNumber; }
    public String getPinHash() { return pinHash; }
    public String getName() { return name; }
    public String getOccupation() { return occupation; }
    public UserRole getRole() { return role; }
    public int getPinFailedCount() { return pinFailedCount; }
    public Instant getPinLockedUntil() { return pinLockedUntil; }
    public Instant getCreatedAt() { return createdAt; }

    public void resetPin(String pinHash) {
        this.pinHash = Objects.requireNonNull(pinHash, "pinHash");
        setPinFailureState(0, null);
    }

    public void setProfile(String name, String occupation) {
        this.name = Objects.requireNonNull(name, "name");
        this.occupation = Objects.requireNonNull(occupation, "occupation");
    }

    public void setPinFailureState(int count, Instant lockedUntil) {
        if (count < 0 || count > 20) throw new IllegalArgumentException("Invalid PIN failure count");
        this.pinFailedCount = count;
        this.pinLockedUntil = lockedUntil;
    }
}
