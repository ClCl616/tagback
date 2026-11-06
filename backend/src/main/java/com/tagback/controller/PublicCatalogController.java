package com.tagback.controller;

import com.tagback.config.PublicApi;
import com.tagback.dto.item.PublicCatalogResponses;
import com.tagback.service.PublicCatalogService;
import com.tagback.service.SearchQuery;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/catalog/item-types")
public class PublicCatalogController {
    private final PublicCatalogService catalog;
    public PublicCatalogController(PublicCatalogService catalog) { this.catalog = catalog; }

    @PublicApi
    @GetMapping
    public PublicCatalogResponses.ItemTypePage list(@RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) @Pattern(regexp = "[1-9][0-9]{0,18}") @DecimalMax("9223372036854775807") String itemTypeId,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "false") @Pattern(regexp = "true|false") String availableOnly,
            HttpServletRequest request) {
        SearchQuery.rejectRepeated(request, "page", "size", "itemTypeId", "keyword", "availableOnly");
        if (request.getParameter("availableOnly") != null && request.getParameter("availableOnly").isEmpty()) throw SearchQuery.invalid();
        return catalog.list(page, size, itemTypeId == null ? null : Long.valueOf(itemTypeId), keyword, Boolean.parseBoolean(availableOnly));
    }

    @PublicApi
    @GetMapping("/{itemTypeId}")
    public PublicCatalogResponses.Detail detail(@PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemTypeId) {
        return catalog.detail(Long.parseLong(itemTypeId));
    }
}
