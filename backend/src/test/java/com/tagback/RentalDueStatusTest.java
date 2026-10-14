package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemType;
import com.tagback.domain.entity.Rental;
import com.tagback.domain.entity.RentalStatus;
import com.tagback.dto.rental.RentalResponses;
import java.time.Instant;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RentalDueStatusTest {
    private static final Instant DUE = Instant.parse("2026-10-17T03:00:00Z");

    @Test void overdueStartsStrictlyAfterStoredDueAtAndReturnTakesPrecedence() {
        var type = mock(ItemType.class);
        when(type.getId()).thenReturn(3L);
        when(type.getName()).thenReturn("우산");
        var item = mock(Item.class);
        when(item.getId()).thenReturn(12L);
        when(item.getItemName()).thenReturn("우산 01");
        when(item.getItemType()).thenReturn(type);
        var rental = mock(Rental.class);
        when(rental.getId()).thenReturn(101L);
        when(rental.getItem()).thenReturn(item);
        when(rental.getRentedAt()).thenReturn(DUE.minusSeconds(72 * 3600));
        when(rental.getDueAt()).thenReturn(DUE);

        assertEquals(RentalStatus.RENTED, RentalResponses.Summary.from(rental, DUE.minusNanos(1)).rentalStatus());
        assertEquals(RentalStatus.RENTED, RentalResponses.Summary.from(rental, DUE).rentalStatus());
        assertEquals(RentalStatus.OVERDUE, RentalResponses.Summary.from(rental, DUE.plusNanos(1)).rentalStatus());
        when(rental.getReturnedAt()).thenReturn(DUE.plusSeconds(10));
        assertEquals(RentalStatus.RETURNED, RentalResponses.Summary.from(rental, DUE.plusSeconds(20)).rentalStatus());
        assertEquals(DUE, RentalResponses.Summary.from(rental, DUE.plusSeconds(20)).dueAt());
    }
}
