package com.tagback.service;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemStatusChangeSource;
import com.tagback.domain.entity.ItemStatusHistory;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemStatusHistoryRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.dto.tag.TagRegistrationResponse;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TagRegistrationWriter {
    private final ItemRepository itemRepository;
    private final NfcTagRepository tagRepository;
    private final ItemStatusHistoryRepository statusHistory;
    private final EntityManager entityManager;

    public TagRegistrationWriter(ItemRepository itemRepository, NfcTagRepository tagRepository,
                                 ItemStatusHistoryRepository statusHistory,
                                 EntityManager entityManager) {
        this.itemRepository = itemRepository;
        this.tagRepository = tagRepository;
        this.statusHistory = statusHistory;
        this.entityManager = entityManager;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public TagRegistrationResponse.Tag create(Long itemId, String uid, Long actorUserId) {
        Item item = itemRepository.findForUpdate(itemId).orElseThrow();
        NfcTag tag = tagRepository.saveAndFlush(new NfcTag(uid, item));
        if (item.getStatus() == ItemStatus.TAG_PENDING) {
            item.markAvailable();
            statusHistory.saveAndFlush(new ItemStatusHistory(itemId, ItemStatus.TAG_PENDING, ItemStatus.AVAILABLE,
                    ItemStatusChangeSource.TAG_REGISTRATION, actorUserId, null));
        }
        itemRepository.flush();
        entityManager.refresh(tag);
        return new TagRegistrationResponse.Tag(tag.getId(), tag.getUid(), itemId,
                "ACTIVE", tag.getCreatedAt());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void makeAvailableIfTagged(Long itemId, Long actorUserId) {
        Item item = itemRepository.findForUpdate(itemId).orElseThrow();
        if (item.getStatus() == ItemStatus.TAG_PENDING && tagRepository.existsByItem_Id(itemId)) {
            item.markAvailable();
            statusHistory.saveAndFlush(new ItemStatusHistory(itemId, ItemStatus.TAG_PENDING, ItemStatus.AVAILABLE,
                    ItemStatusChangeSource.TAG_REGISTRATION, actorUserId, null));
            itemRepository.flush();
        }
    }
}
