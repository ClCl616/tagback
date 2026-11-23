package com.tagback.service;

import com.tagback.config.AuthProfiles;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Retains expired authentication records for a day, beyond their retry window. */
@Service
@Profile(AuthProfiles.KAKAO)
public class KakaoAuthCleanupService {
    private static final Duration RETENTION_AFTER_EXPIRY = Duration.ofHours(24);
    private final JdbcTemplate db;
    private final Clock clock;

    public KakaoAuthCleanupService(JdbcTemplate db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${tagback.kakao.cleanup-interval-ms:3600000}",
            initialDelayString = "${tagback.kakao.cleanup-initial-delay-ms:60000}")
    @Transactional
    public void deleteExpiredRecords() {
        var cutoff = Timestamp.from(clock.instant().minus(RETENTION_AFTER_EXPIRY));
        db.update("delete from auth_operations where operation_type in ('KAKAO_SIGNUP','KAKAO_NEW_BROWSER_LOGIN','KAKAO_PIN_RESET') and expires_at <= ?", cutoff);
        db.update("delete from kakao_auth_challenges where expires_at <= ?", cutoff);
        db.update("delete from kakao_auth_rate_limits where window_started_at <= ?", cutoff);
    }
}
