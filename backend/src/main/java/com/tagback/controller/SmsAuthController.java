package com.tagback.controller;

import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.service.sms.SmsAuthService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/auth/sms")
public class SmsAuthController {
    private final SmsAuthService service;
    public SmsAuthController(SmsAuthService service) { this.service = service; }

    @PostMapping("/requests")
    public ResponseEntity<AuthResponses.SmsRequested> request(
            @Valid @RequestBody AuthRequests.SmsRequest input,
            @RequestHeader("Idempotency-Key") UUID idempotencyKey) {
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(service.request(input, idempotencyKey));
    }

    @PostMapping("/verifications")
    public ResponseEntity<AuthResponses.SmsVerified> verify(@Valid @RequestBody AuthRequests.SmsVerification input) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.verify(input));
    }
}
