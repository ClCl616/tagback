package com.tagback.controller;

import com.tagback.config.PublicApi;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("sms-mock & !prod & !production")
public class KioskHealthController {
    private final JdbcTemplate jdbc;

    public KioskHealthController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/v1/kiosk/health")
    @PublicApi
    public ResponseEntity<Void> health() {
        jdbc.queryForObject("select 1", Integer.class);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).build();
    }
}
