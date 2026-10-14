package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.domain.repository.RentalAuthorizationStore.Grant;
import com.tagback.dto.rental.RentalRequests;
import com.tagback.dto.rental.RentalResponses;
import com.tagback.service.RentalOperationService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("sms-mock & !prod & !production")
@RequestMapping("/api/v1/rentals")
public class RentalController {
    private final RentalOperationService operations;
    private final AuthOriginGuard origins;
    public RentalController(RentalOperationService operations, AuthOriginGuard origins) {
        this.operations = operations; this.origins = origins;
    }

    @PostMapping
    @RentalAuthenticated
    public ResponseEntity<RentalResponses.Checkout> checkout(@Valid @RequestBody RentalRequests.Checkout body,
            @RequestAttribute(RentalAuthenticationInterceptor.ATTRIBUTE) Grant grant, HttpServletRequest request) {
        origins.check(request);
        var result = operations.checkout(grant, RentalHeaders.idempotencyKey(request),
                Long.parseLong(body.itemId()), Long.parseLong(body.itemTypeId()));
        return ResponseEntity.status(result.created() ? 201 : 200).cacheControl(CacheControl.noStore()).body(result.response());
    }
}
