package com.tagback.service;

import com.tagback.domain.repository.RentalAuthorizationStore;
import com.tagback.domain.repository.RentalAuthorizationStore.Grant;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.exception.RentalException;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("sms-mock & !prod & !production")
public class RentalOperationService {
    private final RentalAuthorizationStore store;
    private final RentalCheckoutService checkout;
    private final Clock clock;

    public RentalOperationService(RentalAuthorizationStore store, RentalCheckoutService checkout, Clock clock) {
        this.store = store; this.checkout = checkout; this.clock = clock;
    }

    @Transactional
    public Outcome checkout(Grant authenticatedGrant, UUID key, long itemId, long itemTypeId) {
        var grant = store.grantById(authenticatedGrant.id()).orElseThrow(RentalException::grantInvalid);
        var code = store.lockCode(grant.codeId()).orElseThrow(RentalException::grantInvalid);
        requireUnexpired(grant.expiresAt(), code.expiresAt());
        var prior = store.operation(grant.id(), key);
        if (prior.isPresent()) {
            var result = prior.get();
            if (result.itemId() != itemId || result.itemTypeId() != itemTypeId) {
                throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
            }
            return new Outcome(false, RentalResponses.Checkout.from(result));
        }
        if (code.consumedAt() != null) throw RentalException.codeConsumed();
        var result = checkout.checkout(code.userId(), itemId, itemTypeId);
        // The item lock may have waited beyond the grant lifetime: roll back all writes in that case.
        requireUnexpired(grant.expiresAt(), code.expiresAt());
        store.consumeCode(code.id(), clock.instant());
        store.insertOperation(grant.id(), key, result);
        return new Outcome(true, RentalResponses.Checkout.from(result));
    }

    private void requireUnexpired(Instant grantExpiry, Instant codeExpiry) {
        var now = clock.instant();
        if (!grantExpiry.isAfter(now) || !codeExpiry.isAfter(now)) throw RentalException.grantExpired();
    }
    public record Outcome(boolean created, RentalResponses.Checkout response) {}
}
