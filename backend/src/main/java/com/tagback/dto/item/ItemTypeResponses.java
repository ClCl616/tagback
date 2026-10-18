package com.tagback.dto.item;

import com.tagback.domain.entity.ItemType;
import java.util.List;

public final class ItemTypeResponses {
    private ItemTypeResponses() {}

    public record Detail(String itemTypeId, String itemTypeName) {
        public static Detail from(ItemType type) {
            return new Detail(type.getId().toString(), type.getName());
        }
    }

    public record ListResult(List<Detail> itemTypes) {
        public ListResult {
            itemTypes = List.copyOf(itemTypes);
        }
    }
}
