package com.tagback.dto.tag;

import java.time.OffsetDateTime;

public record TagRegistrationResponse(Tag tag) {
    public record Tag(Long tagId, String uid, Long itemId, String status, OffsetDateTime createdAt) {
    }
}
