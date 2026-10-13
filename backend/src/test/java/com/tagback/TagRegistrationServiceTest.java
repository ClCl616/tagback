package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagRegistrationService;
import com.tagback.service.TagRegistrationWriter;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.OffsetDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TagRegistrationServiceTest {
    private ItemRepository itemRepository;
    private NfcTagRepository tagRepository;
    private TagRegistrationWriter writer;
    private TagRegistrationService service;

    @BeforeEach
    void setUp() {
        itemRepository = mock(ItemRepository.class);
        tagRepository = mock(NfcTagRepository.class);
        writer = mock(TagRegistrationWriter.class);
        service = new TagRegistrationService(itemRepository, tagRepository, writer);
    }

    @Test
    void registersNormalizedUidForExistingItem() {
        Item item = mock(Item.class);
        OffsetDateTime createdAt = OffsetDateTime.parse("2026-10-06T12:00:00+09:00");
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        when(writer.create(12L, "04A23B1C5D6E80", null)).thenReturn(new TagRegistrationResponse.Tag(
                1L, "04A23B1C5D6E80", 12L, "ACTIVE", createdAt));

        TagRegistrationService.RegistrationResult result = service.register(12L, "04:a2:3b:1c:5d:6e:80");
        TagRegistrationResponse response = result.response();

        assertEquals(true, result.created());
        assertEquals(1L, response.tag().tagId());
        assertEquals("04A23B1C5D6E80", response.tag().uid());
        assertEquals(12L, response.tag().itemId());
        assertEquals("ACTIVE", response.tag().status());
        assertEquals(createdAt, response.tag().createdAt());
    }

    @Test
    void rejectsMissingItemBeforeSaving() {
        TagRegistrationException exception = assertThrows(TagRegistrationException.class,
                () -> service.register(404L, "04A23B1C5D6E80"));
        assertEquals("ITEM_NOT_FOUND", exception.code());
        verify(writer, never()).create(anyLong(), anyString(), any());
    }

    @Test
    void sameItemAndNormalizedUidReturnsExistingTag() {
        Item item = mock(Item.class);
        NfcTag existing = mock(NfcTag.class);
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        when(tagRepository.findByItem_Id(12L)).thenReturn(Optional.of(existing));
        when(existing.getId()).thenReturn(1L);
        when(existing.getUid()).thenReturn("04A23B1C5D6E80");

        TagRegistrationService.RegistrationResult result = service.register(12L, "04:a2:3b:1c:5d:6e:80");

        assertEquals(false, result.created());
        assertEquals(1L, result.response().tag().tagId());
        assertEquals("04A23B1C5D6E80", result.response().tag().uid());
        verify(writer, never()).create(anyLong(), anyString(), any());
        verify(writer).makeAvailableIfTagged(12L, null);
    }

    @Test
    void rejectsKnownUidOnAnotherItemAndDifferentUidOnSameItem() {
        Item item = mock(Item.class);
        NfcTag existing = mock(NfcTag.class);
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        when(tagRepository.findByUid("04A23B1C5D6E80")).thenReturn(Optional.of(existing));
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E80")).code());

        when(tagRepository.findByItem_Id(12L)).thenReturn(Optional.of(existing));
        when(existing.getUid()).thenReturn("04A23B1C5D6E80");
        assertEquals("ITEM_ALREADY_TAGGED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E81")).code());
        verify(writer, never()).create(anyLong(), anyString(), any());
    }

    @Test
    void mapsDatabaseUniqueViolationsAfterConcurrentPrechecks() {
        Item item = mock(Item.class);
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        ConstraintViolationException violation = mock(ConstraintViolationException.class);
        when(writer.create(anyLong(), anyString(), any()))
                .thenThrow(new DataIntegrityViolationException("duplicate", violation));

        when(violation.getConstraintName()).thenReturn("nfc_tags_tag_uid_key");
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E80")).code());

        when(violation.getConstraintName()).thenReturn("nfc_tags_item_id_key");
        assertEquals("ITEM_ALREADY_TAGGED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E81")).code());
    }

    @Test
    void returnsWinnerAfterUniqueViolationOnSamePair() {
        Item item = mock(Item.class);
        NfcTag winner = mock(NfcTag.class);
        ConstraintViolationException violation = mock(ConstraintViolationException.class);
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        when(tagRepository.findByItem_Id(12L))
                .thenReturn(Optional.empty(), Optional.of(winner));
        when(winner.getUid()).thenReturn("04A23B1C5D6E80");
        when(winner.getId()).thenReturn(1L);
        when(violation.getConstraintName()).thenReturn("nfc_tags_item_id_key");
        when(writer.create(12L, "04A23B1C5D6E80", null))
                .thenThrow(new DataIntegrityViolationException("duplicate", violation));

        TagRegistrationService.RegistrationResult result = service.register(12L, "04A23B1C5D6E80");

        assertEquals(false, result.created());
        assertEquals(1L, result.response().tag().tagId());
        verify(writer).makeAvailableIfTagged(12L, null);
    }
}
