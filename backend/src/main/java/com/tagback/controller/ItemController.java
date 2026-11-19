package com.tagback.controller;

import com.tagback.config.AdminOnly;
import com.tagback.config.AuthOriginGuard;
import com.tagback.config.AdminPrincipal;
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
    private final com.tagback.service.AdminAudit audit;

    public ItemController(ItemService service, AuthOriginGuard origins, com.tagback.service.AdminAudit audit) {
        this.service = service;
        this.origins = origins; this.audit = audit;
    }

    @org.springframework.transaction.annotation.Transactional
    @AdminOnly
    @PostMapping
    public ResponseEntity<ItemResponses.Detail> create(
            @Valid @RequestBody ItemRequests.Create body, HttpServletRequest request,
            @RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin) {
        origins.check(request);
        var item = service.create(body);
        audit.record(admin, "ITEM_CREATE", Long.parseLong(item.itemId()), null, null, null);
        return ResponseEntity.created(URI.create("/api/v1/items/" + item.itemId())).body(item);
    }

    @com.tagback.config.AdminReadable
    @GetMapping("/{itemId}")
    public ItemResponses.Detail detail(
            @PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemId) {
        return service.detail(Long.parseLong(itemId));
    }

    @org.springframework.transaction.annotation.Transactional
    @AdminOnly
    @PatchMapping("/{itemId}/status")
    public ItemResponses.Detail changeStatus(
            @PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemId,
            @Valid @RequestBody ItemRequests.StatusChange body,
            @RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin,
            HttpServletRequest request) {
        origins.check(request);
        var result = service.changeStatusAsAdmin(Long.parseLong(itemId), body, null, admin.sessionId());
        audit.record(admin, "ITEM_STATUS", Long.parseLong(itemId), null, null, null);
        return result;
    }

    @org.springframework.transaction.annotation.Transactional
    @AdminOnly
    @PatchMapping("/{itemId}")
    public ItemResponses.Detail update(
            @PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemId,
            @Valid @RequestBody ItemRequests.Update body, HttpServletRequest request,
            @RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin) {
        origins.check(request);
        var result = service.update(Long.parseLong(itemId), body);
        audit.record(admin, "ITEM_UPDATE", Long.parseLong(itemId), null, null, null);
        return result;
    }

    @com.tagback.config.AdminReadable
    @GetMapping
    public ItemResponses.ItemPage list(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemTypeId,
            @RequestParam(required = false) @Pattern(regexp = "TAG_PENDING|AVAILABLE|RENTED|INSPECTION|REPAIR") String status,
            @RequestParam(required = false) String keyword, HttpServletRequest request) {
        com.tagback.service.SearchQuery.rejectRepeated(request, "page", "size", "itemTypeId", "status", "keyword");
        var type = itemTypeId == null ? null : Long.valueOf(itemTypeId);
        var parsedStatus = status == null ? null : ItemStatus.valueOf(status);
        if (keyword == null) return service.list(page, size, type, parsedStatus);
        return service.search(page, size, type, parsedStatus, keyword, false);
    }

    @org.springframework.transaction.annotation.Transactional
    @AdminOnly
    @DeleteMapping("/{itemId}")
    public ResponseEntity<Void> delete(
            @PathVariable @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemId, HttpServletRequest request,
            @RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin) {
        origins.check(request);
        service.delete(Long.parseLong(itemId));
        audit.record(admin, "ITEM_DELETE", Long.parseLong(itemId), null, null, null);
        return ResponseEntity.noContent().build();
    }
}
