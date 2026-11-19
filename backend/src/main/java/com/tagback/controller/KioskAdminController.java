package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.dto.item.ItemResponses;
import com.tagback.dto.rental.NfcScanProof;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.service.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/kiosk/admin")
public class KioskAdminController {
    private final AdminSessionService sessions;
    private final AuthOriginGuard origins;
    private final ItemService items;
    private final TagRegistrationService tags;
    private final KioskTagService registration;
    public KioskAdminController(AdminSessionService sessions, AuthOriginGuard origins, ItemService items,
            TagRegistrationService tags, KioskTagService registration) {
        this.sessions=sessions;this.origins=origins;this.items=items;this.tags=tags;this.registration=registration;
    }
    public record Login(String token, UUID sessionId, java.time.Instant expiresAt) {
        @Override public String toString() { return "KioskAdminLogin[redacted]"; }
    }
    @PostMapping("/login") @PublicApi
    public ResponseEntity<Login> login(@Valid @RequestBody AdminAuthController.Password body, HttpServletRequest request) {
        origins.check(request);
        var login=sessions.login(body.password(),"KIOSK");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Login(login.token(),login.principal().sessionId(),login.principal().expiresAt()));
    }
    @PostMapping("/logout") @AdminOnly
    public ResponseEntity<Void> logout(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin, HttpServletRequest request) {
        origins.check(request);sessions.logout(admin);return ResponseEntity.noContent().build();
    }
    @GetMapping("/session") @AdminOnly
    public AdminPrincipal session(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin) { return admin; }
    @GetMapping("/items") @AdminOnly
    public ItemResponses.ItemPage items(@RequestParam(defaultValue="") String keyword,
            @RequestParam(defaultValue="0") @Min(0) int page, @RequestParam(defaultValue="false") boolean pending) {
        return items.search(page,20,null,pending ? com.tagback.domain.entity.ItemStatus.TAG_PENDING : null,keyword,true);
    }
    @GetMapping("/items/{itemId}/tag") @AdminOnly
    public TagRegistrationResponse tag(@PathVariable @Min(1) long itemId) { return tags.current(itemId); }
    public record Connect(@NotNull UUID operationId, @NotNull @Min(1) Long itemId,
            @Pattern(regexp="(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})") String expectedUid,
            @NotNull @Valid NfcScanProof proof) {}
    @PostMapping("/tags") @AdminOnly
    public KioskTagService.Result connect(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin,
            @Valid @RequestBody Connect body, HttpServletRequest request) {
        origins.check(request);
        return registration.connect(admin,body.operationId(),body.itemId(),body.expectedUid(),body.proof());
    }
}
