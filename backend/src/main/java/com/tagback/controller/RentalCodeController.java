package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.dto.rental.RentalRequests;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.service.RentalCodeService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1")
public class RentalCodeController {
    private final RentalCodeService codes;
    private final AuthOriginGuard origins;
    public RentalCodeController(RentalCodeService codes, AuthOriginGuard origins) {
        this.codes = codes; this.origins = origins;
    }

    @PostMapping("/rental-codes")
    public ResponseEntity<RentalResponses.Code> issue(@Valid @RequestBody RentalRequests.IssueCode body,
            @RequestAttribute(AuthenticatedUser.ATTRIBUTE) AuthenticatedUser user, HttpServletRequest request) {
        origins.check(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(codes.issue(user.userId()));
    }

    @PostMapping("/kiosk/rental-grants")
    @PublicApi
    public ResponseEntity<RentalResponses.Grant> verify(@Valid @RequestBody RentalRequests.VerifyCode body,
                                                       HttpServletRequest request) {
        origins.check(request);
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore())
                .body(codes.verify(body.code(), request.getRemoteAddr()));
    }
}
