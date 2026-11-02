package com.tagback.controller;

import com.tagback.config.AuthOriginGuard;
import com.tagback.config.AuthenticatedUser;
import com.tagback.dto.rental.RentalRequests;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.RentalReturnService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/rentals")
public class RentalReturnController {
    private final RentalReturnService returns;
    private final AuthOriginGuard origins;

    public RentalReturnController(RentalReturnService returns, AuthOriginGuard origins) {
        this.returns = returns;
        this.origins = origins;
    }

    @PostMapping("/return")
    public ResponseEntity<RentalResponses.Returned> returnItem(
            @Valid @RequestBody RentalRequests.Return body,
            @RequestAttribute(AuthenticatedUser.ATTRIBUTE) AuthenticatedUser user,
            HttpServletRequest request) {
        origins.check(request);
        if (request.getParameterMap().containsKey("userId")) {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        var result = returns.returnItem(user.userId(), Long.parseLong(body.itemId()));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(RentalResponses.Returned.from(result));
    }
}
