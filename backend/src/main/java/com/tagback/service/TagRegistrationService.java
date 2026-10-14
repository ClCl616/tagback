package com.tagback.service;

import com.tagback.domain.entity.NfcTag;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.NfcTagRepository;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import org.hibernate.exception.ConstraintViolationException;
import org.postgresql.util.PSQLException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.util.Optional;

@Service
public class TagRegistrationService {
    private final ItemRepository itemRepository;
    private final NfcTagRepository tagRepository;
    private final TagRegistrationWriter writer;

    public TagRegistrationService(ItemRepository itemRepository, NfcTagRepository tagRepository,
                                  TagRegistrationWriter writer) {
        this.itemRepository = itemRepository;
        this.tagRepository = tagRepository;
        this.writer = writer;
    }

    public RegistrationResult register(Long itemId, String rawUid) {
        return register(itemId, rawUid, null);
    }

    public RegistrationResult register(Long itemId, String rawUid, Long actorUserId) {
        String uid = TagUidNormalizer.normalize(rawUid);
        if (itemRepository.findById(itemId).isEmpty()) {
            throw new TagRegistrationException(HttpStatus.NOT_FOUND, "ITEM_NOT_FOUND", "물품을 찾을 수 없습니다.");
        }

        Optional<NfcTag> attached = tagRepository.findByItem_Id(itemId);
        if (attached.isPresent()) {
            RegistrationResult result = existingOrConflict(attached.get(), itemId, uid);
            writer.makeAvailableIfTagged(itemId, actorUserId);
            return result;
        }
        if (tagRepository.findByUid(uid).isPresent()) {
            throw alreadyRegistered();
        }

        try {
            return new RegistrationResult(new TagRegistrationResponse(writer.create(itemId, uid, actorUserId)), true);
        } catch (DataIntegrityViolationException exception) {
            String constraint = constraintName(exception);
            if (!isKnownUniqueConstraint(constraint) && !hasUniqueSqlState(exception)) {
                throw exception;
            }

            // The insert's REQUIRES_NEW transaction has rolled back. A fresh read can now see
            // the winning request without using PostgreSQL's aborted transaction.
            Optional<NfcTag> winner = tagRepository.findByItem_Id(itemId);
            if (winner.isPresent() && uid.equals(winner.get().getUid())) {
                RegistrationResult result = existingOrConflict(winner.get(), itemId, uid);
                writer.makeAvailableIfTagged(itemId, actorUserId);
                return result;
            }
            if ("nfc_tags_tag_uid_key".equals(constraint)) {
                throw alreadyRegistered();
            }
            if ("nfc_tags_item_id_key".equals(constraint)
                    || "uq_nfc_tags_active_item".equals(constraint)) {
                throw itemAlreadyTagged();
            }
            if (winner.isPresent()) {
                throw itemAlreadyTagged();
            }
            if (tagRepository.findByUid(uid).isPresent()) {
                throw alreadyRegistered();
            }
            throw exception;
        }
    }

    private static RegistrationResult existingOrConflict(NfcTag tag, Long itemId, String uid) {
        if (!uid.equals(tag.getUid())) {
            throw itemAlreadyTagged();
        }
        return new RegistrationResult(new TagRegistrationResponse(new TagRegistrationResponse.Tag(
                tag.getId(), tag.getUid(), itemId, "ACTIVE", tag.getCreatedAt())), false);
    }

    private static boolean isKnownUniqueConstraint(String constraint) {
        return "nfc_tags_tag_uid_key".equals(constraint)
                || "nfc_tags_item_id_key".equals(constraint)
                || "uq_nfc_tags_active_item".equals(constraint);
    }

    private static boolean hasUniqueSqlState(Throwable exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof PSQLException postgres && "23505".equals(postgres.getSQLState())) {
                return true;
            }
            if (cause instanceof ConstraintViolationException violation
                    && "23505".equals(violation.getSQLState())) {
                return true;
            }
        }
        return false;
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

    public record RegistrationResult(TagRegistrationResponse response, boolean created) {
    }
}
