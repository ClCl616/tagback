package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.exception.AuthException;
import com.tagback.exception.ItemException;
import com.tagback.exception.RentalException;
import com.tagback.service.RentalCheckoutService;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RentalCheckoutServiceTest {
    private final ItemRepository items = mock(ItemRepository.class);
    private final NfcTagRepository tags = mock(NfcTagRepository.class);
    private final RentalRepository rentals = mock(RentalRepository.class);
    private final ItemStatusHistoryRepository history = mock(ItemStatusHistoryRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final RentalCheckoutService service = new RentalCheckoutService(items, tags, rentals, history, users,
            Clock.fixed(Instant.parse("2026-10-14T03:00:00Z"), ZoneOffset.UTC));
    private Item item;

    @BeforeEach void setup() {
        var type = new ItemType("우산", null);
        ReflectionTestUtils.setField(type, "id", 1L);
        item = new Item("우산 1", ItemStatus.AVAILABLE, type);
        ReflectionTestUtils.setField(item, "id", 10L);
        when(users.findById(77L)).thenReturn(Optional.of(new User("+821033333333", "test", Instant.EPOCH)));
        when(items.findForUpdate(10L)).thenReturn(Optional.of(item));
        when(tags.existsByItem_Id(10L)).thenReturn(true);
    }

    @ParameterizedTest
    @EnumSource(value = ItemStatus.class, names = "AVAILABLE", mode = EnumSource.Mode.EXCLUDE)
    void rejectsEveryUnavailableStatus(ItemStatus status) {
        item.updateStatus(status);
        assertUnavailable();
        verify(rentals, never()).saveAndFlush(any());
        verifyNoInteractions(history);
    }

    @Test void rejectsMissingTagEvenIfItemSaysAvailable() {
        when(tags.existsByItem_Id(10L)).thenReturn(false);
        assertUnavailable();
        verify(rentals, never()).saveAndFlush(any());
        verifyNoInteractions(history);
    }

    @Test void rejectsActiveRentalEvenIfItemSaysAvailable() {
        when(rentals.existsByItem_IdAndReturnedAtIsNull(10L)).thenReturn(true);
        assertEquals("RENTAL_ALREADY_ACTIVE", assertThrows(RentalException.class,
                () -> service.checkout(77L, 10L, 1L)).code());
        verify(rentals, never()).saveAndFlush(any());
        verifyNoInteractions(history);
        assertEquals(ItemStatus.AVAILABLE, item.getStatus());
    }

    @Test void rejectsDifferentSelectedTypeBeforeWriting() {
        assertEquals("ITEM_TYPE_MISMATCH", assertThrows(RentalException.class,
                () -> service.checkout(77L, 10L, 2L)).code());
        verifyNoInteractions(rentals, history);
    }

    @Test void rejectsMissingItem() {
        assertEquals("ITEM_NOT_FOUND", assertThrows(ItemException.class,
                () -> service.checkout(77L, 99L, 1L)).code());
        verifyNoInteractions(rentals, history);
    }

    @Test void rejectsMissingAuthenticatedAccount() {
        assertThrows(AuthException.class, () -> service.checkout(99L, 10L, 1L));
        verifyNoInteractions(items, rentals, history);
    }

    @Test void translatesOnlyKnownActiveRentalUniqueViolation() {
        var sql = new SQLException("duplicate", "23505");
        var violation = new ConstraintViolationException("duplicate", sql, "uq_active_rental_item");
        when(rentals.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("duplicate", violation));
        assertEquals("RENTAL_ALREADY_ACTIVE", assertThrows(RentalException.class,
                () -> service.checkout(77L, 10L, 1L)).code());
        verifyNoInteractions(history);
    }

    @Test void preservesUnrelatedDatabaseFailure() {
        var failure = new DataIntegrityViolationException("unrelated storage error");
        when(rentals.saveAndFlush(any())).thenThrow(failure);
        assertSame(failure, assertThrows(DataIntegrityViolationException.class,
                () -> service.checkout(77L, 10L, 1L)));
        verifyNoInteractions(history);
    }

    private void assertUnavailable() {
        assertEquals("ITEM_NOT_AVAILABLE", assertThrows(RentalException.class,
                () -> service.checkout(77L, 10L, 1L)).code());
    }
}
