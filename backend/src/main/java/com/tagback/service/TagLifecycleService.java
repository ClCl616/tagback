package com.tagback.service;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.dto.tag.TagLookupResponse;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import jakarta.persistence.EntityManager;
import org.hibernate.exception.ConstraintViolationException;
import org.postgresql.util.PSQLException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TagLifecycleService {
    private final ItemRepository items;
    private final NfcTagRepository tags;
    private final EntityManager entityManager;

    public TagLifecycleService(ItemRepository items, NfcTagRepository tags, EntityManager entityManager) {
        this.items = items;
        this.tags = tags;
        this.entityManager = entityManager;
    }

    @Transactional
    public TagRegistrationService.RegistrationResult replace(Long itemId, String rawUid, String rawExpectedUid) {
        Item item = items.findForUpdate(itemId).orElseThrow(() ->
                new TagRegistrationException(HttpStatus.NOT_FOUND, "ITEM_NOT_FOUND", "물품을 찾을 수 없습니다."));
        String uid = TagUidNormalizer.normalize(rawUid);
        NfcTag active = tags.findByItem_Id(itemId).orElse(null);
        if (active != null && uid.equals(active.getUid())) {
            return new TagRegistrationService.RegistrationResult(response(active, itemId), false);
        }
        String expectedUid = rawExpectedUid == null ? null : TagUidNormalizer.normalize(rawExpectedUid);
        if (!java.util.Objects.equals(expectedUid, active == null ? null : active.getUid())) {
            throw new TagRegistrationException(HttpStatus.CONFLICT, "TAG_CHANGED", "활성 태그가 변경되었습니다.");
        }
        rejectIfRented(item);
        NfcTag previous = tags.findByUid(uid).orElse(null);
        if (previous != null && !itemId.equals(previous.getItem().getId())) {
            throw new TagRegistrationException(HttpStatus.CONFLICT, "TAG_ALREADY_REGISTERED", "이미 등록된 태그입니다.");
        }

        if (previous != null && previous.getDeactivatedAt() == null) {
            return new TagRegistrationService.RegistrationResult(response(previous, itemId), false);
        }

        if (active != null) {
            active.deactivate();
            tags.flush(); // Release the partial unique index before reactivating or inserting.
        }
        try {
            if (previous != null) {
                previous.reactivate();
                tags.flush();
                return new TagRegistrationService.RegistrationResult(response(previous, itemId), true);
            }
            NfcTag created = tags.saveAndFlush(new NfcTag(uid, item));
            entityManager.refresh(created);
            return new TagRegistrationService.RegistrationResult(response(created, itemId), true);
        } catch (DataIntegrityViolationException exception) {
            for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
                if (cause instanceof ConstraintViolationException violation && "23505".equals(violation.getSQLState())) {
                    throw conflict(violation.getConstraintName());
                }
                if (cause instanceof PSQLException postgres && "23505".equals(postgres.getSQLState())) {
                    String name = postgres.getServerErrorMessage() == null ? null
                            : postgres.getServerErrorMessage().getConstraint();
                    throw conflict(name);
                }
            }
            throw exception;
        }
    }

    @Transactional
    public void deactivate(Long itemId) {
        Item item = items.findForUpdate(itemId).orElseThrow(() ->
                new TagRegistrationException(HttpStatus.NOT_FOUND, "ITEM_NOT_FOUND", "물품을 찾을 수 없습니다."));
        NfcTag active = tags.findByItem_Id(itemId).orElse(null);
        if (active == null) return;
        rejectIfRented(item);
        active.deactivate();
    }

    private void rejectIfRented(Item item) {
        if (item.getStatus() == ItemStatus.RENTED || items.hasUnreturnedRental(item.getId())) {
            throw new TagRegistrationException(HttpStatus.CONFLICT, "ITEM_RENTED", "대여 중인 물품의 태그는 변경할 수 없습니다.");
        }
    }

    @Transactional(readOnly = true)
    public TagLookupResponse lookup(String rawUid) {
        String uid = TagUidNormalizer.normalize(rawUid);
        NfcTag tag = tags.findByUid(uid).orElseThrow(() ->
                new TagRegistrationException(HttpStatus.NOT_FOUND, "TAG_NOT_FOUND", "태그를 찾을 수 없습니다."));
        if (tag.getDeactivatedAt() != null) {
            throw new TagRegistrationException(HttpStatus.CONFLICT, "TAG_INACTIVE", "비활성화된 태그입니다.");
        }
        Item item = tag.getItem();
        return new TagLookupResponse(
                new TagLookupResponse.Item(item.getId(), item.getItemName(), item.getStatus(),
                        item.getStatus() == ItemStatus.AVAILABLE),
                new TagLookupResponse.Tag(uid, "ACTIVE"));
    }

    private static TagRegistrationResponse response(NfcTag tag, Long itemId) {
        return new TagRegistrationResponse(new TagRegistrationResponse.Tag(
                tag.getId(), tag.getUid(), itemId, "ACTIVE", tag.getCreatedAt()));
    }

    private static TagRegistrationException conflict(String constraint) {
        if ("uq_nfc_tags_active_item".equals(constraint)) {
            return new TagRegistrationException(HttpStatus.CONFLICT, "ITEM_ALREADY_TAGGED",
                    "물품에 이미 태그가 연결되어 있습니다.");
        }
        return new TagRegistrationException(HttpStatus.CONFLICT, "TAG_ALREADY_REGISTERED",
                "이미 등록된 태그입니다.");
    }
}
