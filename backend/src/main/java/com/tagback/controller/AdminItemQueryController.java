package com.tagback.controller;

import com.tagback.config.AdminOnly;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.dto.item.ItemResponses;
import com.tagback.service.ItemService;
import com.tagback.service.SearchQuery;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin/items")
public class AdminItemQueryController {
    private final ItemService items;
    public AdminItemQueryController(ItemService items) { this.items = items; }

    @AdminOnly
    @GetMapping
    public ItemResponses.ItemPage list(@RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) @Pattern(regexp = "[1-9][0-9]{0,18}") @DecimalMax("9223372036854775807") String itemTypeId,
            @RequestParam(required = false) @Pattern(regexp = "TAG_PENDING|AVAILABLE|RENTED|INSPECTION|REPAIR") String status,
            @RequestParam(required = false) String keyword, HttpServletRequest request) {
        SearchQuery.rejectRepeated(request, "page", "size", "itemTypeId", "status", "keyword");
        return items.search(page, size, itemTypeId == null ? null : Long.valueOf(itemTypeId),
                status == null ? null : ItemStatus.valueOf(status), keyword, true);
    }
}
