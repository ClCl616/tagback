package com.tagback.service;

import com.tagback.domain.repository.ItemTypeRepository;
import com.tagback.dto.item.PublicCatalogResponses;
import com.tagback.exception.ItemException;
import java.util.Locale;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PublicCatalogService {
    private final ItemTypeRepository types;
    public PublicCatalogService(ItemTypeRepository types) { this.types = types; }

    @Transactional(readOnly = true)
    public PublicCatalogResponses.ItemTypePage list(int page, int size, Long typeId, String keyword, boolean availableOnly) {
        SearchQuery.page(page, size);
        String normalized = SearchQuery.keyword(keyword);
        String pattern = SearchQuery.pattern(normalized == null ? "" : normalized.toLowerCase(Locale.ROOT));
        var result = types.catalog(typeId, pattern, availableOnly, PageRequest.of(page, size, Sort.by("id")));
        return new PublicCatalogResponses.ItemTypePage(result.getContent().stream().map(PublicCatalogService::detail).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public PublicCatalogResponses.Detail detail(long id) {
        return list(0, 1, id, null, false).itemTypes().stream().findFirst().orElseThrow(ItemException::new);
    }

    private static PublicCatalogResponses.Detail detail(ItemTypeRepository.CatalogRow row) {
        return new PublicCatalogResponses.Detail(row.getId().toString(), row.getName(), row.getTotalCount(), row.getAvailableCount());
    }
}
