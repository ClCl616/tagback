package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.item.ItemRequests;
import com.tagback.exception.ItemException;
import com.tagback.service.ItemService;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ItemStatusServiceTest {
    private final ItemRepository items = mock(ItemRepository.class);
    private final NfcTagRepository tags = mock(NfcTagRepository.class);
    private final ItemStatusHistoryRepository history = mock(ItemStatusHistoryRepository.class);
    private final ItemService service = new ItemService(items, mock(ItemTypeRepository.class), tags, history,
            mock(EntityManager.class));
    private Item item;

    @BeforeEach void setup() {
        var type = new ItemType("우산", null);
        ReflectionTestUtils.setField(type, "id", 1L);
        item = new Item("우산 01", ItemStatus.INSPECTION, type);
        ReflectionTestUtils.setField(item, "id", 10L);
        when(items.findForUpdate(10L)).thenReturn(Optional.of(item));
        when(tags.existsByItem_Id(10L)).thenReturn(true);
    }

    @Test void changesStatusAndPersistsActorAndReasonInHistory() {
        var request = request("REPAIR", " 외관 손상 ");

        var result = service.changeStatus(10L, request, 77L);

        assertEquals("REPAIR", result.status().name());
        var captor = org.mockito.ArgumentCaptor.forClass(ItemStatusHistory.class);
        verify(history).save(captor.capture());
        assertEquals(ItemStatus.INSPECTION, captor.getValue().getFromStatus());
        assertEquals(ItemStatus.REPAIR, captor.getValue().getToStatus());
        assertEquals(ItemStatusChangeSource.ADMIN_API, captor.getValue().getSource());
        assertEquals(77L, captor.getValue().getChangedByUserId());
        assertEquals("외관 손상", captor.getValue().getReason());
        verify(items).findForUpdate(10L);
        verify(items).hasActiveRental(10L);
        verify(items).flush();
        verify(history).flush();
    }

    @Test void sameStatusIsIdempotentAndDoesNotCreateHistory() {
        var result = service.changeStatus(10L, request("INSPECTION", null), 77L);
        assertEquals(ItemStatus.INSPECTION.name(), result.status().name());
        verifyNoInteractions(history);
        verify(items, never()).hasActiveRental(anyLong());
        verify(items, never()).flush();
    }

    @Test void rejectsCurrentStatusWithActiveRentalOrWithoutRequiredTag() {
        when(items.hasActiveRental(10L)).thenReturn(true);
        assertEquals("ITEM_STATUS_CHANGE_CONFLICT", assertThrows(ItemException.class,
                () -> service.changeStatus(10L, request("REPAIR", null), 77L)).code());
        verifyNoInteractions(history);

        when(items.hasActiveRental(10L)).thenReturn(false);
        when(tags.existsByItem_Id(10L)).thenReturn(false);
        assertEquals("ITEM_STATUS_CHANGE_CONFLICT", assertThrows(ItemException.class,
                () -> service.changeStatus(10L, request("AVAILABLE", null), 77L)).code());
        verify(items, never()).flush();
        verifyNoInteractions(history);
    }

    @Test void rejectsManagedStatusWritesFromTagPendingAndRentedStates() {
        for (ItemStatus current : new ItemStatus[]{ItemStatus.TAG_PENDING, ItemStatus.RENTED}) {
            item.updateStatus(current);
            assertEquals("ITEM_STATUS_CHANGE_CONFLICT", assertThrows(ItemException.class,
                    () -> service.changeStatus(10L, request("INSPECTION", null), 77L)).code());
        }
        verify(items, never()).hasActiveRental(anyLong());
        verifyNoInteractions(history);
    }

    @Test void reportsMissingItem() {
        when(items.findForUpdate(99L)).thenReturn(Optional.empty());
        assertEquals("ITEM_NOT_FOUND", assertThrows(ItemException.class,
                () -> service.changeStatus(99L, request("INSPECTION", null), 77L)).code());
        verifyNoInteractions(history);
    }

    private ItemRequests.StatusChange request(String status, String reason) {
        var request = new ItemRequests.StatusChange();
        request.setStatus(status);
        if (reason != null) request.setReason(reason);
        return request;
    }
}
