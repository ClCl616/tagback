package com.tagback.service;

import com.tagback.domain.repository.RentalRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Advisory only: a future withdrawal transaction must repeat the check while holding the required locks. */
@Service
@Profile(com.tagback.config.AuthProfiles.CORE)
public class WithdrawalEligibilityService {
    private final RentalRepository rentals;

    public WithdrawalEligibilityService(RentalRepository rentals) { this.rentals = rentals; }

    @Transactional(readOnly = true)
    public boolean hasOutstandingRentals(long userId) {
        return rentals.existsByUser_IdAndReturnedAtIsNull(userId);
    }
}
