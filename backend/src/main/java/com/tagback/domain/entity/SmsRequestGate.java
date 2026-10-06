package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "sms_request_gates")
public class SmsRequestGate {
    @Id
    @Column(name = "phone_number", length = 20)
    private String phoneNumber;
    @Column(name = "resend_available_at")
    private Instant resendAvailableAt;

    protected SmsRequestGate() {}
    public String getPhoneNumber() { return phoneNumber; }
    public Instant getResendAvailableAt() { return resendAvailableAt; }
}

