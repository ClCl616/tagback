package com.tagback.service;

import com.tagback.config.AdminPrincipal;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AdminSessionService {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final String passwordHash;
    private final TransactionTemplate counters;
    public AdminSessionService(JdbcTemplate jdbc, Clock clock, PlatformTransactionManager manager,
            @Value("${tagback.admin.password-hash:}") String passwordHash) {
        this.jdbc = jdbc; this.clock = clock; this.passwordHash = passwordHash.trim();
        counters = new TransactionTemplate(manager);
        counters.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    public Login login(String password, String channel) {
        if (!"WEB".equals(channel) && !"KIOSK".equals(channel)) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        if (passwordHash.isEmpty()) throw new AuthException(AuthErrorCode.ADMIN_NOT_CONFIGURED);
        var window = clock.instant().truncatedTo(ChronoUnit.MINUTES);
        // Global shared-password budget, persisted separately so failures cannot roll it back.
        Long attempts = counters.execute(tx -> jdbc.queryForObject(
                "insert into admin_login_limits values ('shared-password', ?, 1) on conflict (scope) do update "
                + "set window_start=excluded.window_start, attempts=case when admin_login_limits.window_start=excluded.window_start "
                + "then admin_login_limits.attempts+1 else 1 end returning attempts", Long.class, Timestamp.from(window)));
        if (attempts == null || attempts > 10) throw new AuthException(AuthErrorCode.ADMIN_LOGIN_LIMITED, window.plusSeconds(60));
        if (!AdminPassword.matches(password, passwordHash)) throw new AuthException(AuthErrorCode.ADMIN_PASSWORD_INVALID);
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        var now = clock.instant();
        var principal = new AdminPrincipal(UUID.randomUUID(), channel, now.plusSeconds(channel.equals("KIOSK") ? 600 : 1800));
        jdbc.update("insert into admin_sessions(session_id, token_hash, password_version, channel, created_at, expires_at) values (?,?,?,?,?,?)",
                principal.sessionId(), AdminPassword.digest(token), AdminPassword.digest(passwordHash), channel,
                Timestamp.from(now), Timestamp.from(principal.expiresAt()));
        return new Login(token, principal);
    }
    public AdminPrincipal authenticate(String token, String channel) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}") || passwordHash.isEmpty())
            throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
        return jdbc.query("select session_id, channel, expires_at from admin_sessions where token_hash=? "
                + "and channel=? and password_version=? and revoked_at is null and expires_at>?",
                (rs,n) -> new AdminPrincipal(rs.getObject(1, UUID.class), rs.getString(2), rs.getTimestamp(3).toInstant()),
                AdminPassword.digest(token), channel, AdminPassword.digest(passwordHash), Timestamp.from(clock.instant()))
                .stream().findFirst().orElseThrow(() -> new AuthException(AuthErrorCode.SESSION_EXPIRED));
    }
    public void logout(AdminPrincipal principal) {
        jdbc.update("update admin_sessions set revoked_at=? where session_id=?", Timestamp.from(clock.instant()), principal.sessionId());
    }
    public record Login(String token, AdminPrincipal principal) {
        @Override public String toString() { return "AdminLogin[redacted]"; }
    }
}
