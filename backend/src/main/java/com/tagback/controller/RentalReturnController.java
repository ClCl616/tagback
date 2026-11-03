package com.tagback.controller;

import com.tagback.config.AuthOriginGuard;
import com.tagback.config.PublicApi;
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

    @PostMapping("/return/scan")
    @PublicApi
    public ResponseEntity<RentalResponses.ReturnScan> scanReturnTag(
            @Valid @RequestBody RentalRequests.ReturnScan body,
            HttpServletRequest request) {
        origins.check(request);
        if (request.getParameterMap().containsKey("userId")) {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(RentalResponses.ReturnScan.from(returns.scanTag(body.proof())));
    }

    @PostMapping("/return")
    @PublicApi
    public ResponseEntity<RentalResponses.Returned> returnItem(
            @Valid @RequestBody RentalRequests.Return body,
            HttpServletRequest request) {
        origins.check(request);
        if (request.getParameterMap().containsKey("userId")) {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        var result = returns.returnItem(java.util.UUID.fromString(body.scanTicketId()), body.proof(), body.condition());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(RentalResponses.Returned.from(result));
    }
}
