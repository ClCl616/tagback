package com.tagback.controller;

import com.tagback.config.AuthCookies;
import com.tagback.config.AuthOriginGuard;
import com.tagback.config.PublicApi;
import com.tagback.dto.auth.AuthRequests;
import com.tagback.dto.auth.AuthResponses;
import com.tagback.service.PinResetService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/auth/pin")
public class PinResetController {
    private final PinResetService service;
    private final AuthOriginGuard originGuard;
    private final AuthCookies cookies;

    public PinResetController(PinResetService service, AuthOriginGuard originGuard, AuthCookies cookies) {
        this.service = service; this.originGuard = originGuard; this.cookies = cookies;
    }

    @PostMapping("/reset")
    @PublicApi
    public ResponseEntity<AuthResponses.PinResetResult> reset(@Valid @RequestBody AuthRequests.PinReset input,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        originGuard.check(request);
        var result = service.reset(input, key);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, cookies.clearAll()).body(result);
    }
}
