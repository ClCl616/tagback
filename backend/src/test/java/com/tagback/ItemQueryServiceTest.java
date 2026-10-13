package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.exception.*;
import com.tagback.service.ItemService;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ItemQueryServiceTest {
    private final ItemRepository items = mock(ItemRepository.class);
    private final ItemService service = new ItemService(items, mock(ItemTypeRepository.class),
            mock(NfcTagRepository.class), mock(ItemStatusHistoryRepository.class), mock(EntityManager.class));

    @Test void mapsDetailAndReportsMissingItem() {
        var item = item();
        when(items.findById(10L)).thenReturn(Optional.of(item));
        assertEquals("10", service.detail(10L).itemId());
        when(items.findById(99L)).thenReturn(Optional.empty());
        assertEquals("ITEM_NOT_FOUND", assertThrows(ItemException.class, () -> service.detail(99L)).code());
    }

    @Test void forwardsFiltersSortAndPaginationAndMapsTotals() {
        var pageable = PageRequest.of(1, 2, Sort.by(Sort.Direction.DESC, "id"));
        var item = item();
        when(items.findFiltered(1L, ItemStatus.RENTED, pageable))
                .thenReturn(new PageImpl<>(List.of(item), pageable, 3));
        var result = service.list(1, 2, 1L, ItemStatus.RENTED);
        assertEquals(3, result.totalElements());
        assertEquals(2, result.totalPages());
        assertEquals(1, result.page());
        assertEquals("우산", result.items().getFirst().itemName());
        verify(items).findFiltered(1L, ItemStatus.RENTED, pageable);
    }

    @Test void returnsEmptyPageAndRejectsJpaOffsetOverflow() {
        var pageable = PageRequest.of(0, 20, Sort.by(Sort.Direction.DESC, "id"));
        when(items.findFiltered(null, null, pageable)).thenReturn(Page.empty(pageable));
        var result = service.list(0, 20, null, null);
        assertTrue(result.items().isEmpty());
        assertEquals(0, result.totalPages());
        clearInvocations(items);
        assertThrows(AuthException.class, () -> service.list(Integer.MAX_VALUE, 20, null, null));
        verifyNoInteractions(items);
    }

    private Item item() {
        var type = mock(ItemType.class);
        when(type.getId()).thenReturn(1L);
        when(type.getName()).thenReturn("우산");
        var item = mock(Item.class);
        when(item.getId()).thenReturn(10L);
        when(item.getItemName()).thenReturn("우산");
        when(item.getItemType()).thenReturn(type);
        when(item.getStatus()).thenReturn(ItemStatus.RENTED);
        when(item.getCreatedAt()).thenReturn(OffsetDateTime.parse("2026-10-07T01:00:00Z"));
        return item;
    }
}
