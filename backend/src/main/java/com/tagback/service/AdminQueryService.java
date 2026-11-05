package com.tagback.service;

import com.tagback.domain.repository.RentalRepository;
import com.tagback.domain.repository.UserRepository;
import com.tagback.dto.admin.AdminQueryResponses;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import java.time.Clock;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminQueryService {
    private final UserRepository users;
    private final RentalRepository rentals;
    private final Clock clock;

    public AdminQueryService(UserRepository users, RentalRepository rentals, Clock clock) {
        this.users = users;
        this.rentals = rentals;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AdminQueryResponses.UserPage users(int page, int size) {
        var result = users.findAll(pageRequest(page, size));
        return new AdminQueryResponses.UserPage(result.map(AdminQueryResponses.UserSummary::from).getContent(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public AdminQueryResponses.RentalPage rentals(int page, int size) {
        var request = pageRequest(page, size);
        var now = clock.instant();
        var result = rentals.findAll(request);
        return new AdminQueryResponses.RentalPage(result.map(r -> AdminQueryResponses.RentalSummary.from(r, now)).getContent(),
                page, size, result.getTotalElements(), result.getTotalPages(), now);
    }

    private PageRequest pageRequest(int page, int size) {
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE) {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        return PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"));
    }
}
