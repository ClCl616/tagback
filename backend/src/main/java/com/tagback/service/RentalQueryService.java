package com.tagback.service;

import com.tagback.domain.repository.RentalRepository;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import java.time.Clock;
import org.springframework.context.annotation.Profile;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("sms-mock & !prod & !production")
public class RentalQueryService {
    private final RentalRepository rentals;
    private final Clock clock;

    public RentalQueryService(RentalRepository rentals, Clock clock) {
        this.rentals = rentals;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public RentalResponses.RentalPage list(long authenticatedUserId, String scope, int page, int size) {
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE) {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        var evaluatedAt = clock.instant();
        org.springframework.data.domain.Page<com.tagback.domain.entity.Rental> result;
        if ("ACTIVE".equals(scope)) {
            var sort = Sort.by(Sort.Order.asc("dueAt"), Sort.Order.desc("id"));
            result = rentals.findByUser_IdAndReturnedAtIsNull(authenticatedUserId, PageRequest.of(page, size, sort));
        } else if ("HISTORY".equals(scope)) {
            var sort = Sort.by(Sort.Order.desc("returnedAt"), Sort.Order.desc("id"));
            result = rentals.findByUser_IdAndReturnedAtIsNotNull(authenticatedUserId, PageRequest.of(page, size, sort));
        } else {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        return new RentalResponses.RentalPage(result.getContent().stream()
                .map(rental -> RentalResponses.Summary.from(rental, evaluatedAt)).toList(),
                page, size, result.getTotalElements(), result.getTotalPages(), evaluatedAt);
    }
}
