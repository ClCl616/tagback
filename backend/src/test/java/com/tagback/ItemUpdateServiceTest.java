package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.item.ItemRequests;
import com.tagback.exception.ItemException;
import com.tagback.service.ItemService;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ItemUpdateServiceTest {
    private final ItemRepository items = mock(ItemRepository.class);
    private final ItemTypeRepository types = mock(ItemTypeRepository.class);
    private final ItemService service = new ItemService(items, types, mock(EntityManager.class));
    private Item item;
    private ItemType original;

    @BeforeEach void setup() {
        original = type(1L, "우산");
        item = new Item("우산 01", ItemStatus.RENTED, original);
        ReflectionTestUtils.setField(item, "id", 10L);
        ReflectionTestUtils.setField(item, "createdAt", OffsetDateTime.parse("2026-10-07T01:00:00Z"));
        when(items.findForUpdate(10L)).thenReturn(Optional.of(item));
    }

    @Test void nameChangePreservesTypeStatusAndCreationTime() {
        var patch = new ItemRequests.Update();
        patch.setItemName(" 우산 02 ");
        var result = service.update(10L, patch);
        assertEquals("우산 02", item.getItemName());
        assertSame(original, item.getItemType());
        assertEquals(ItemStatus.RENTED, result.status());
        assertEquals(item.getCreatedAt(), result.createdAt());
        verify(items, never()).hasUsageHistory(anyLong());
        verify(items).flush();
    }

    @Test void typeOnlyChangePreservesNameAndRejectsHistory() {
        var replacement = type(2L, "계산기");
        when(types.findById(2L)).thenReturn(Optional.of(replacement));
        var patch = new ItemRequests.Update();
        patch.setItemTypeId("2");
        when(items.hasUsageHistory(10L)).thenReturn(true);
        assertEquals("ITEM_TYPE_CHANGE_CONFLICT", assertThrows(ItemException.class, () -> service.update(10L, patch)).code());
        assertSame(original, item.getItemType());
        verify(items, never()).flush();
        when(items.hasUsageHistory(10L)).thenReturn(false);
        var result = service.update(10L, patch);
        assertEquals("2", result.itemTypeId());
        assertEquals("우산 01", result.itemName());
    }

    @Test void sameTypeDoesNotRejectExistingHistory() {
        var patch = new ItemRequests.Update();
        patch.setItemTypeId("1");
        assertEquals("1", service.update(10L, patch).itemTypeId());
        verify(items, never()).hasUsageHistory(anyLong());
        verifyNoInteractions(types);
    }

    @Test void missingItemOrTypeDoesNotModifyItem() {
        var patch = new ItemRequests.Update();
        patch.setItemTypeId("99");
        when(items.findForUpdate(99L)).thenReturn(Optional.empty());
        assertEquals("ITEM_NOT_FOUND", assertThrows(ItemException.class, () -> service.update(99L, patch)).code());
        when(types.findById(99L)).thenReturn(Optional.empty());
        assertEquals("ITEM_TYPE_NOT_FOUND", assertThrows(ItemException.class, () -> service.update(10L, patch)).code());
        assertSame(original, item.getItemType());
        verify(items, never()).flush();
    }

    private ItemType type(long id, String name) {
        var type = new ItemType(name, null);
        ReflectionTestUtils.setField(type, "id", id);
        return type;
    }
}
