package com.tagback.controller;

import com.tagback.config.AuthenticatedUser;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.RentalQueryService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/rentals/me")
public class RentalQueryController {
    private final RentalQueryService queries;

    public RentalQueryController(RentalQueryService queries) {
        this.queries = queries;
    }

    @GetMapping
    public ResponseEntity<RentalResponses.RentalPage> list(
            @RequestAttribute(AuthenticatedUser.ATTRIBUTE) AuthenticatedUser user,
            @RequestParam(defaultValue = "ACTIVE") String scope,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            HttpServletRequest request) {
        if (request.getParameterMap().containsKey("userId")) {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(queries.list(user.userId(), scope, page, size));
    }
}
