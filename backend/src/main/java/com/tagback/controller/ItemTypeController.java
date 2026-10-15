package com.tagback.controller;

import com.tagback.config.SessionOrRentalAuthenticated;
import com.tagback.dto.item.ItemTypeResponses;
import com.tagback.service.ItemTypeService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/item-types")
public class ItemTypeController {
    private final ItemTypeService types;

    public ItemTypeController(ItemTypeService types) {
        this.types = types;
    }

    @GetMapping
    @SessionOrRentalAuthenticated
    public ItemTypeResponses.ListResult list() {
        return types.list();
    }
}
