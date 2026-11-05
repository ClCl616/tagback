package com.tagback.controller;

import com.tagback.config.AdminOnly;
import com.tagback.dto.admin.AdminQueryResponses;
import com.tagback.service.AdminQueryService;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@AdminOnly
@RequestMapping("/api/v1/admin")
public class AdminQueryController {
    private final AdminQueryService queries;

    public AdminQueryController(AdminQueryService queries) { this.queries = queries; }

    @GetMapping("/users")
    public ResponseEntity<AdminQueryResponses.UserPage> users(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(queries.users(page, size));
    }

    @GetMapping("/rentals")
    public ResponseEntity<AdminQueryResponses.RentalPage> rentals(
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(queries.rentals(page, size));
    }
}
