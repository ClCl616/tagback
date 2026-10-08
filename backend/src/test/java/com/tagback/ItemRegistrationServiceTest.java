package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.item.ItemRequests;
import com.tagback.dto.item.TagRequests;
import com.tagback.exception.ItemException;
import com.tagback.service.ItemService;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ItemRegistrationServiceTest {
    @Test
    void savesTagPendingItemAndReloadsDatabaseTimestamp() {
        var items = mock(ItemRepository.class);
        var types = mock(ItemTypeRepository.class);
        var em = mock(EntityManager.class);
        var type = mock(ItemType.class);
        when(type.getId()).thenReturn(1L);
        when(type.getName()).thenReturn("우산");
        when(types.findById(1L)).thenReturn(Optional.of(type));
        var saved = mock(Item.class);
        when(saved.getId()).thenReturn(10L);
        when(saved.getItemName()).thenReturn("우산");
        when(saved.getItemType()).thenReturn(type);
        when(saved.getStatus()).thenReturn(ItemStatus.TAG_PENDING);
        var timestamp = OffsetDateTime.parse("2026-10-07T01:00:00Z");
        doAnswer(invocation -> { when(saved.getCreatedAt()).thenReturn(timestamp); return null; })
                .when(em).refresh(saved);
        when(items.saveAndFlush(any())).thenReturn(saved);
        var response = new ItemService(items, types, mock(NfcTagRepository.class), em)
                .create(new ItemRequests.Create(" 우산 ", "1"));
        var captured = ArgumentCaptor.forClass(Item.class);
        verify(items).saveAndFlush(captured.capture());
        assertEquals("우산", captured.getValue().getItemName());
        assertEquals(ItemStatus.TAG_PENDING, captured.getValue().getStatus());
        assertSame(type, captured.getValue().getItemType());
        assertEquals(timestamp, response.createdAt());
    }

    @Test
    void missingTypeDoesNotInsertItem() {
        var items = mock(ItemRepository.class);
        var types = mock(ItemTypeRepository.class);
        var em = mock(EntityManager.class);
        when(types.findById(99L)).thenReturn(Optional.empty());
        assertThrows(ItemException.class, () -> new ItemService(items, types, mock(NfcTagRepository.class), em)
                .create(new ItemRequests.Create("우산", "99")));
        verifyNoInteractions(items, em);
    }

    @Test
    void assigningTagMakesTagPendingItemAvailable() {
        var items = mock(ItemRepository.class);
        var types = mock(ItemTypeRepository.class);
        var tags = mock(NfcTagRepository.class);
        var em = mock(EntityManager.class);
        var type = mock(ItemType.class);
        when(type.getId()).thenReturn(1L);
        when(type.getName()).thenReturn("우산");
        var item = new Item("우산", ItemStatus.TAG_PENDING, type);
        org.springframework.test.util.ReflectionTestUtils.setField(item, "id", 10L);
        org.springframework.test.util.ReflectionTestUtils.setField(item, "createdAt", OffsetDateTime.parse("2026-10-07T01:00:00Z"));
        when(items.findForUpdate(10L)).thenReturn(Optional.of(item));
        when(tags.existsByItem_Id(10L)).thenReturn(false);
        when(tags.findByUid("TAG-01")).thenReturn(Optional.empty());
        when(tags.saveAndFlush(any(NfcTag.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response = new ItemService(items, types, tags, em)
                .assignTag(10L, new TagRequests.Assign(" TAG-01 "));

        assertEquals(ItemStatus.AVAILABLE, item.getStatus());
        assertEquals(ItemStatus.AVAILABLE, response.status());
        var captor = ArgumentCaptor.forClass(NfcTag.class);
        verify(tags).saveAndFlush(captor.capture());
        assertEquals("TAG-01", captor.getValue().getUid());
        assertSame(item, captor.getValue().getItem());
        verify(items).flush();
    }

    @Test
    void assigningTagToAlreadyTaggedItemReturnsConflictWithoutSaving() {
        var items = mock(ItemRepository.class);
        var tags = mock(NfcTagRepository.class);
        var item = mock(Item.class);
        when(items.findForUpdate(10L)).thenReturn(Optional.of(item));
        when(tags.existsByItem_Id(10L)).thenReturn(true);

        var failure = assertThrows(ItemException.class, () -> new ItemService(items,
                mock(ItemTypeRepository.class), tags, mock(EntityManager.class))
                .assignTag(10L, new TagRequests.Assign("TAG-01")));

        assertEquals("ITEM_TAG_ALREADY_ASSIGNED", failure.code());
        verify(tags, never()).saveAndFlush(any(NfcTag.class));
    }
}
