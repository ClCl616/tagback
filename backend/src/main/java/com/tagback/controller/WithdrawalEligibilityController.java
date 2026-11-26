package com.tagback.controller;

import com.tagback.config.AuthenticatedUser;
import com.tagback.service.WithdrawalEligibilityService;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Reports outstanding rentals only. It does not perform or authorize account deletion. */
@RestController
@Profile(com.tagback.config.AuthProfiles.CORE)
@RequestMapping("/api/v1/account")
public class WithdrawalEligibilityController {
    private final WithdrawalEligibilityService eligibility;

    public WithdrawalEligibilityController(WithdrawalEligibilityService eligibility) { this.eligibility = eligibility; }

    @GetMapping("/outstanding-rentals")
    public ResponseEntity<OutstandingRentals> outstandingRentals(
            @RequestAttribute(AuthenticatedUser.ATTRIBUTE) AuthenticatedUser user) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new OutstandingRentals(eligibility.hasOutstandingRentals(user.userId())));
    }

    public record OutstandingRentals(boolean hasOutstandingRentals) {}
}
