package com.tagback.dto.rental;

import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.RentalStatus;
import com.tagback.service.RentalCheckoutService.CheckoutResult;
import java.time.Instant;

public final class RentalResponses {
    private RentalResponses() {}
    public record Code(String code, Instant expiresAt) {}
    public record Grant(String token, Instant expiresAt, String maskedPhoneNumber) {}
    public record Checkout(String rentalId, String itemId, String itemTypeId,
                           RentalStatus rentalStatus, ItemStatus itemStatus,
                           Instant rentedAt, Instant dueAt, Instant returnedAt) {
        public static Checkout from(CheckoutResult result) {
            return new Checkout(result.rentalId().toString(), result.itemId().toString(), result.itemTypeId().toString(),
                    result.rentalStatus(), result.itemStatus(), result.rentedAt(), result.dueAt(), result.returnedAt());
        }
    }
}
