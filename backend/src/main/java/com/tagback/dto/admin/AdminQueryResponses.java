package com.tagback.dto.admin;

import com.tagback.domain.entity.Rental;
import com.tagback.domain.entity.ReturnCondition;
import com.tagback.domain.entity.User;
import com.tagback.domain.entity.UserRole;
import com.tagback.dto.rental.RentalResponses;
import java.time.Instant;
import java.util.List;

public final class AdminQueryResponses {
    private AdminQueryResponses() {}

    public record UserSummary(String userId, String name, String occupation, UserRole role, Instant createdAt) {
        public static UserSummary from(User user) {
            return new UserSummary(user.getId().toString(), user.getName(), user.getOccupation(),
                    user.getRole(), user.getCreatedAt());
        }
    }

    public record UserPage(List<UserSummary> users, int page, int size, long totalElements, int totalPages) {
        public UserPage { users = List.copyOf(users); }
    }

    public record RentalSummary(String rentalId, String userId, String userName, String itemId,
                                String itemName, String itemTypeId, String itemTypeName,
                                com.tagback.domain.entity.RentalStatus rentalStatus,
                                Instant rentedAt, Instant dueAt, Instant returnedAt, boolean overdue,
                                ReturnCondition returnCondition) {
        public static RentalSummary from(Rental rental, Instant evaluatedAt) {
            var summary = RentalResponses.Summary.from(rental, evaluatedAt);
            return new RentalSummary(summary.rentalId(), rental.getUser().getId().toString(),
                    rental.getUser().getName(), summary.itemId(), summary.itemName(), summary.itemTypeId(),
                    summary.itemTypeName(), summary.rentalStatus(), summary.rentedAt(), summary.dueAt(),
                    summary.returnedAt(), summary.overdue(), rental.getReturnCondition());
        }
    }

    public record RentalPage(List<RentalSummary> rentals, int page, int size, long totalElements,
                             int totalPages, Instant evaluatedAt) {
        public RentalPage { rentals = List.copyOf(rentals); }
    }
}
