package com.tagback.dto.tag;

import com.tagback.domain.entity.ItemStatus;

public record TagLookupResponse(Item item, Tag tag) {
    public record Item(Long itemId, String name, ItemStatus status, boolean rentable,
                       String itemTypeId, String itemTypeName) {
    }

    public record Tag(String uid, String status) {
    }
}
