package com.tagback.dto.rental;

import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.Rental;
import com.tagback.domain.entity.RentalStatus;
import com.tagback.domain.entity.ReturnCondition;
import com.tagback.service.RentalCheckoutService.CheckoutResult;
import com.tagback.service.RentalReturnService.ReturnResult;
import com.tagback.service.RentalReturnService.ReturnScanResult;
import java.time.Instant;
import java.util.List;

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

    public record Returned(String rentalId, String itemId, RentalStatus rentalStatus, ItemStatus itemStatus,
                           ReturnCondition condition, Instant rentedAt, Instant dueAt, Instant returnedAt) {
        public static Returned from(ReturnResult result) {
            return new Returned(result.rentalId().toString(), result.itemId().toString(),
                    result.rentalStatus(), result.itemStatus(), result.condition(), result.rentedAt(), result.dueAt(),
                    result.returnedAt());
        }
    }

    public record ReturnScan(String scanTicketId, String rentalId, String itemId, String itemName,
                             String itemTypeId, String itemTypeName) {
        public static ReturnScan from(ReturnScanResult result) {
            return new ReturnScan(result.scanTicketId().toString(), result.rentalId().toString(), result.itemId().toString(),
                    result.itemName(), result.itemTypeId().toString(), result.itemTypeName());
        }
    }

    public record Summary(String rentalId, String itemId, String itemName,
                          String itemTypeId, String itemTypeName, RentalStatus rentalStatus,
                          Instant rentedAt, Instant dueAt, Instant returnedAt) {
        public static Summary from(Rental rental, Instant evaluatedAt) {
            var item = rental.getItem();
            var status = rental.getReturnedAt() != null ? RentalStatus.RETURNED
                    : evaluatedAt.isAfter(rental.getDueAt()) ? RentalStatus.OVERDUE : RentalStatus.RENTED;
            return new Summary(rental.getId().toString(), item.getId().toString(), item.getItemName(),
                    item.getItemType().getId().toString(), item.getItemType().getName(), status,
                    rental.getRentedAt(), rental.getDueAt(), rental.getReturnedAt());
        }
    }

    public record RentalPage(List<Summary> rentals, int page, int size,
                             long totalElements, int totalPages, Instant evaluatedAt) {
        public RentalPage {
            rentals = List.copyOf(rentals);
        }
    }
}
