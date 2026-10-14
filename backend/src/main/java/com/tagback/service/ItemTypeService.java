package com.tagback.service;

import com.tagback.domain.repository.ItemTypeRepository;
import com.tagback.dto.item.ItemTypeResponses;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ItemTypeService {
    private final ItemTypeRepository types;

    public ItemTypeService(ItemTypeRepository types) {
        this.types = types;
    }

    @Transactional(readOnly = true)
    public ItemTypeResponses.ListResult list() {
        return new ItemTypeResponses.ListResult(types.findAll(Sort.by("id")).stream()
                .map(ItemTypeResponses.Detail::from).toList());
    }
}
