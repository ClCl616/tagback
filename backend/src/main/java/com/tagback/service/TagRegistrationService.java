package com.tagback.service;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.NfcTagRepository;
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
public class TagRegistrationService {
    private final ItemRepository itemRepository;
    private final NfcTagRepository tagRepository;
    private final EntityManager entityManager;

    public TagRegistrationService(ItemRepository itemRepository, NfcTagRepository tagRepository,
                                  EntityManager entityManager) {
        this.itemRepository = itemRepository;
        this.tagRepository = tagRepository;
        this.entityManager = entityManager;
    }

    @Transactional
    public TagRegistrationResponse register(Long itemId, String rawUid) {
        String uid = TagUidNormalizer.normalize(rawUid);
        Item item = itemRepository.findById(itemId).orElseThrow(() ->
                new TagRegistrationException(HttpStatus.NOT_FOUND, "ITEM_NOT_FOUND", "물품을 찾을 수 없습니다."));

        if (tagRepository.existsByUid(uid)) {
            throw alreadyRegistered();
        }
        if (tagRepository.existsByItem_Id(itemId)) {
            throw itemAlreadyTagged();
        }

        try {
            NfcTag tag = tagRepository.saveAndFlush(new NfcTag(uid, item));
            entityManager.refresh(tag);
            return new TagRegistrationResponse(new TagRegistrationResponse.Tag(
                    tag.getId(), tag.getUid(), itemId, "ACTIVE", tag.getCreatedAt()));
        } catch (DataIntegrityViolationException exception) {
            String constraint = constraintName(exception);
            if ("nfc_tags_tag_uid_key".equals(constraint)) {
                throw alreadyRegistered();
            }
            if ("nfc_tags_item_id_key".equals(constraint)
                    || "uq_nfc_tags_active_item".equals(constraint)) {
                throw itemAlreadyTagged();
            }
            throw exception;
        }
    }

    private static String constraintName(Throwable exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation) {
                if (violation.getConstraintName() != null) {
                    return violation.getConstraintName();
                }
            }
            if (cause instanceof PSQLException postgres && "23505".equals(postgres.getSQLState())
                    && postgres.getServerErrorMessage() != null) {
                return postgres.getServerErrorMessage().getConstraint();
            }
        }
        return null;
    }

    private static TagRegistrationException alreadyRegistered() {
        return new TagRegistrationException(HttpStatus.CONFLICT, "TAG_ALREADY_REGISTERED",
                "이미 등록된 태그입니다.");
    }

    private static TagRegistrationException itemAlreadyTagged() {
        return new TagRegistrationException(HttpStatus.CONFLICT, "ITEM_ALREADY_TAGGED",
                "물품에 이미 태그가 연결되어 있습니다.");
    }
}
