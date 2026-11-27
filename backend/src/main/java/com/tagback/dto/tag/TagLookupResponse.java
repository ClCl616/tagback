package com.tagback.dto.tag;

import com.tagback.domain.entity.ItemStatus;

public record TagLookupResponse(Item item, Tag tag) {
    public record Item(Long itemId, String name, ItemStatus status, boolean rentable,
                       String itemTypeId, String itemTypeName, String imageUrl) {
        public Item(Long id,String name,ItemStatus status,boolean rentable,String typeId,String typeName){this(id,name,status,rentable,typeId,typeName,null);}
    }

    public record Tag(String uid, String status) {
    }
}
