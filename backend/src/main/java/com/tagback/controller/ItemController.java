package com.tagback.controller;

import com.tagback.config.AdminOnly;
import com.tagback.config.AuthOriginGuard;
import com.tagback.dto.item.ItemRequests;
import com.tagback.dto.item.ItemResponses;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.service.ItemService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/items")
public class ItemController {
    private final ItemService service;
    private final AuthOriginGuard origins;

    public ItemController(ItemService service, AuthOriginGuard origins) {
        this.service = service;
        this.origins = origins;
    }

    @AdminOnly
    @PostMapping
    public ResponseEntity<ItemResponses.Detail> create(
            @Valid @RequestBody ItemRequests.Create body, HttpServletRequest request) {
        origins.check(request);
        var item = service.create(body);
        return ResponseEntity.created(URI.create("/api/v1/items/" + item.itemId())).body(item);
    }

    @GetMapping("/{itemId}")
    public ItemResponses.Detail detail(
            @PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemId) {
        return service.detail(Long.parseLong(itemId));
    }

    @AdminOnly
    @PatchMapping("/{itemId}")
    public ItemResponses.Detail update(
            @PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemId,
            @Valid @RequestBody ItemRequests.Update body, HttpServletRequest request) {
        origins.check(request);
        return service.update(Long.parseLong(itemId), body);
    }

    @GetMapping
    public ItemResponses.ItemPage list(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemTypeId,
            @RequestParam(required = false) @Pattern(regexp = "AVAILABLE|RENTED|INSPECTION|REPAIR") String status) {
        return service.list(page, size, itemTypeId == null ? null : Long.valueOf(itemTypeId),
                status == null ? null : ItemStatus.valueOf(status));
    }

    @AdminOnly
    @DeleteMapping("/{itemId}")
    public ResponseEntity<Void> delete(
            @PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemId, HttpServletRequest request) {
        origins.check(request);
        service.delete(Long.parseLong(itemId));
        return ResponseEntity.noContent().build();
    }
}
