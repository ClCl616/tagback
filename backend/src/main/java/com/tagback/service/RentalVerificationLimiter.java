package com.tagback.service;

import com.tagback.domain.repository.RentalAuthorizationStore;
import com.tagback.exception.RentalException;
import com.tagback.service.sms.SmsSecrets;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@Profile("sms-mock & !prod & !production")
public class RentalVerificationLimiter {
    private final RentalAuthorizationStore store;
    private final SmsSecrets secrets;
    private final Clock clock;
    private final TransactionTemplate counters;
    private final int perAddress;
    private final int global;

    public RentalVerificationLimiter(RentalAuthorizationStore store, SmsSecrets secrets, Clock clock,
            PlatformTransactionManager manager,
            @Value("${tagback.rental.verify-per-address-per-minute:10}") int perAddress,
            @Value("${tagback.rental.verify-global-per-minute:60}") int global) {
        if (perAddress < 1 || global < 1) throw new IllegalArgumentException("Rental verification limits must be positive");
        this.store = store; this.secrets = secrets; this.clock = clock;
        this.perAddress = perAddress; this.global = global;
        counters = new TransactionTemplate(manager);
        counters.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public void check(String remoteAddress) {
        var window = clock.instant().truncatedTo(ChronoUnit.MINUTES);
        // A failed verification must still consume the attempt. Never trust client-supplied forwarding headers.
        boolean allowed = Boolean.TRUE.equals(counters.execute(tx -> {
            long all = store.countAttempt(secrets.keyedHash("rental-verify-global"), window);
            long local = store.countAttempt(secrets.keyedHash("rental-verify-address:" + remoteAddress), window);
            return all <= global && local <= perAddress;
        }));
        if (!allowed) throw RentalException.verificationLimited(window.plusSeconds(60));
    }
}
