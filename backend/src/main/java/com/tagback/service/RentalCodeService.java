package com.tagback.service;

import com.tagback.domain.repository.RentalAuthorizationStore;
import com.tagback.domain.repository.UserRepository;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.exception.*;
import java.time.Clock;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile(com.tagback.config.AuthProfiles.CORE)
public class RentalCodeService {
    private final RentalAuthorizationStore store;
    private final UserRepository users;
    private final AuthSecrets secrets;
    private final RentalVerificationLimiter limiter;
    private final Clock clock;
    private final int issueLimit;

    public RentalCodeService(RentalAuthorizationStore store, UserRepository users, AuthSecrets secrets,
            RentalVerificationLimiter limiter, Clock clock,
            @Value("${tagback.rental.new-codes-per-user-per-hour:10}") int issueLimit) {
        if (issueLimit < 1) throw new IllegalArgumentException("Rental code issuance limit must be positive");
        this.store = store; this.users = users; this.secrets = secrets; this.limiter = limiter;
        this.clock = clock; this.issueLimit = issueLimit;
    }

    @Transactional
    public RentalResponses.Code issue(long authenticatedUserId) {
        // Match withdrawal's user-first lock order; issuance also serializes code-space reuse.
        users.findByIdForUpdate(authenticatedUserId).orElseThrow(() -> new AuthException(AuthErrorCode.ACCOUNT_NOT_FOUND));
        store.lockIssuance();
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        store.releaseExpiredCodes(now);
        var active = store.activeCode(authenticatedUserId);
        if (active.isPresent()) return new RentalResponses.Code(displayCode(active.get().id()), active.get().expiresAt());
        if (store.issuedSince(authenticatedUserId, now.minus(Duration.ofHours(1))) >= issueLimit) {
            throw RentalException.issuanceLimited();
        }
        for (int attempt = 0; attempt < 32; attempt++) {
            UUID id = UUID.randomUUID();
            String code = displayCode(id);
            var expires = now.plusSeconds(180);
            if (store.insertCode(id, authenticatedUserId, codeHash(code), now, expires)) {
                return new RentalResponses.Code(code, expires);
            }
        }
        throw RentalException.codeUnavailable();
    }

    @Transactional
    public RentalResponses.Grant verify(String code, String remoteAddress) {
        limiter.check(remoteAddress);
        var stored = store.lockCodeByHash(codeHash(code)).orElseThrow(RentalException::codeInvalid);
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (!stored.expiresAt().isAfter(now) || stored.consumedAt() != null) throw RentalException.codeInvalid();
        var user = users.findById(stored.userId()).orElseThrow(RentalException::codeInvalid);
        String token = secrets.generateToken();
        store.insertGrant(UUID.randomUUID(), stored.id(), secrets.tokenHash(token), now, stored.expiresAt());
        return new RentalResponses.Grant(token, stored.expiresAt(), user.getId().toString(),
                user.getName() == null || user.getName().isBlank() ? "회원" : user.getName());
    }

    @Transactional(readOnly = true)
    public RentalAuthorizationStore.Grant authenticate(String token) {
        var grant = store.grantByHash(secrets.tokenHash(token)).orElseThrow(RentalException::grantInvalid);
        if (!grant.expiresAt().isAfter(clock.instant())) throw RentalException.grantExpired();
        // Consumed codes remain authentic for same-operation replay until the original expiry.
        return grant;
    }

    private String codeHash(String code) { return secrets.keyedHash("rental-code-lookup:" + code); }
    private String displayCode(UUID id) {
        // Re-display an active code without keeping its plaintext; keep its HMAC domain separate.
        long value = Long.parseLong(secrets.keyedHash("rental-code-display:" + id).substring(0, 12), 16);
        return String.format(Locale.ROOT, "%06d", value % 1_000_000);
    }
}
