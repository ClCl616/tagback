package com.tagback.dto.item;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import java.time.OffsetDateTime;
import java.util.List;

public final class ItemResponses {
    private ItemResponses() {}

    public record Detail(String itemId, String itemName, String itemTypeId,
                         String itemTypeName, ItemStatus status, OffsetDateTime createdAt) {
        /** Map inside a transaction because itemType is a lazy association. */
        public static Detail from(Item item) {
            return new Detail(item.getId().toString(), item.getItemName(),
                    item.getItemType().getId().toString(), item.getItemType().getName(),
                    item.getStatus(), item.getCreatedAt());
        }
    }

    public record ItemPage(List<Detail> items, int page, int size,
                           long totalElements, int totalPages) {
        public ItemPage {
            items = List.copyOf(items);
        }
    }
}
