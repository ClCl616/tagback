package com.tagback.controller;

import com.tagback.service.sms.SmsAuthService;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/dev/sms/requests")
public class MockSmsController {
    private final SmsAuthService service;
    public MockSmsController(SmsAuthService service) { this.service = service; }

    @GetMapping("/{requestId}")
    public ResponseEntity<SmsAuthService.MockCode> code(@PathVariable UUID requestId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.getMockCode(requestId));
    }
}
