package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagRegistrationService;
import jakarta.persistence.EntityManager;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.OffsetDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TagRegistrationServiceTest {
    private ItemRepository itemRepository;
    private NfcTagRepository tagRepository;
    private TagRegistrationService service;

    @BeforeEach
    void setUp() {
        itemRepository = mock(ItemRepository.class);
        tagRepository = mock(NfcTagRepository.class);
        service = new TagRegistrationService(itemRepository, tagRepository, mock(EntityManager.class));
    }

    @Test
    void registersNormalizedUidForExistingItem() {
        Item item = mock(Item.class);
        NfcTag saved = mock(NfcTag.class);
        OffsetDateTime createdAt = OffsetDateTime.parse("2026-10-06T12:00:00+09:00");
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        when(tagRepository.saveAndFlush(any(NfcTag.class))).thenReturn(saved);
        when(saved.getId()).thenReturn(1L);
        when(saved.getUid()).thenReturn("04A23B1C5D6E80");
        when(saved.getCreatedAt()).thenReturn(createdAt);

        TagRegistrationResponse response = service.register(12L, "04:a2:3b:1c:5d:6e:80");

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
        verify(tagRepository, never()).saveAndFlush(any());
    }

    @Test
    void rejectsKnownUidAndAlreadyTaggedItem() {
        Item item = mock(Item.class);
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        when(tagRepository.existsByUid("04A23B1C5D6E80")).thenReturn(true);
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E80")).code());

        when(tagRepository.existsByItem_Id(12L)).thenReturn(true);
        assertEquals("ITEM_ALREADY_TAGGED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E81")).code());
        verify(tagRepository, never()).saveAndFlush(any());
    }

    @Test
    void mapsDatabaseUniqueViolationsAfterConcurrentPrechecks() {
        Item item = mock(Item.class);
        when(itemRepository.findById(12L)).thenReturn(Optional.of(item));
        ConstraintViolationException violation = mock(ConstraintViolationException.class);
        when(tagRepository.saveAndFlush(any(NfcTag.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate", violation));

        when(violation.getConstraintName()).thenReturn("nfc_tags_tag_uid_key");
        assertEquals("TAG_ALREADY_REGISTERED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E80")).code());

        when(violation.getConstraintName()).thenReturn("nfc_tags_item_id_key");
        assertEquals("ITEM_ALREADY_TAGGED", assertThrows(TagRegistrationException.class,
                () -> service.register(12L, "04A23B1C5D6E81")).code());
    }
}
