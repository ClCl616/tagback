package com.tagback.dto.item;

import java.util.List;

public final class PublicCatalogResponses {
    private PublicCatalogResponses() {}
    public record Detail(String itemTypeId, String itemTypeName, long totalCount, long availableCount) {}
    public record ItemTypePage(List<Detail> itemTypes, int page, int size, long totalElements, int totalPages) {
        public ItemTypePage { itemTypes = List.copyOf(itemTypes); }
    }
}
