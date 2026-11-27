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
    public Login login(String password, String channel) { return login("000", password, channel); }
    @org.springframework.transaction.annotation.Transactional
    public Login login(String number, String password, String channel) {
        if (!"WEB".equals(channel) && !"KIOSK".equals(channel)) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        if (!passwordHash.isEmpty()) jdbc.update("insert into administrators(admin_number,name,password_hash,must_change_password) values ('000','\uB300\uD45C \uAD00\uB9AC\uC790',?,false) on conflict do nothing", passwordHash);
        if (number == null || !number.matches("[0-9]{3}")) throw new AuthException(AuthErrorCode.ADMIN_PASSWORD_INVALID);
        var window = clock.instant().truncatedTo(ChronoUnit.MINUTES);
        // Global administrator login budget, persisted separately so failures cannot roll it back.
        Long attempts = counters.execute(tx -> jdbc.queryForObject(
                "insert into admin_login_limits values ('shared-password', ?, 1) on conflict (scope) do update "
                + "set window_start=excluded.window_start, attempts=case when admin_login_limits.window_start=excluded.window_start "
                + "then admin_login_limits.attempts+1 else 1 end returning attempts", Long.class, Timestamp.from(window)));
        if (attempts == null || attempts > 10) throw new AuthException(AuthErrorCode.ADMIN_LOGIN_LIMITED, window.plusSeconds(60));
        var account = jdbc.queryForList("select * from administrators where admin_number=? and active=true for update", number);
        String encoded = account.isEmpty() ? passwordHash : (String)account.getFirst().get("password_hash");
        if (!AdminPassword.matches(password, encoded) || account.isEmpty()) throw new AuthException(AuthErrorCode.ADMIN_PASSWORD_INVALID);
        var row = account.getFirst();
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        var now = clock.instant();
        var principal = new AdminPrincipal(UUID.randomUUID(), channel, now.plusSeconds(channel.equals("KIOSK") ? 1800 : 28800), number, (String)row.get("name"), (Boolean)row.get("must_change_password"));
        jdbc.update("insert into admin_sessions(session_id, token_hash, password_version, channel, created_at, expires_at, admin_number, admin_name) values (?,?,?,?,?,?,?,?)",
                principal.sessionId(), AdminPassword.digest(token), AdminPassword.digest(encoded), channel,
                Timestamp.from(now), Timestamp.from(principal.expiresAt()), number, principal.name());
        return new Login(token, principal);
    }
    public AdminPrincipal authenticate(String token, String channel) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
        return jdbc.query("select s.session_id,s.channel,s.expires_at,a.admin_number,a.name,a.must_change_password,a.password_hash,s.password_version "
                + "from admin_sessions s join administrators a on a.admin_number=s.admin_number where s.token_hash=? "
                + "and s.channel=? and a.active=true and s.revoked_at is null and s.expires_at>?",
                (rs,n) -> AdminPassword.digest(rs.getString(7)).equals(rs.getString(8))
                    ? new AdminPrincipal(rs.getObject(1,UUID.class),rs.getString(2),rs.getTimestamp(3).toInstant(),rs.getString(4),rs.getString(5),rs.getBoolean(6)) : null,
                AdminPassword.digest(token),channel,Timestamp.from(clock.instant()))
                .stream().filter(java.util.Objects::nonNull).findFirst().orElseThrow(() -> new AuthException(AuthErrorCode.SESSION_EXPIRED));
    }
    @org.springframework.transaction.annotation.Transactional
    public void changePassword(AdminPrincipal admin, String current, String next) {
        var encoded=jdbc.queryForObject("select password_hash from administrators where admin_number=? for update",String.class,admin.adminNumber());
        if (!AdminPassword.matches(current,encoded)) throw new AuthException(AuthErrorCode.ADMIN_PASSWORD_INVALID);
        if(next==null || next.length()<8 || next.length()>128 || next.equals(current)) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        var hash=AdminPassword.hash(next);
        jdbc.update("update administrators set password_hash=?,must_change_password=false where admin_number=?",hash,admin.adminNumber());
        jdbc.update("update admin_sessions set revoked_at=? where admin_number=? and session_id<>?",Timestamp.from(clock.instant()),admin.adminNumber(),admin.sessionId());
        jdbc.update("update admin_sessions set password_version=? where session_id=?",AdminPassword.digest(hash),admin.sessionId());
    }
    public void requireRepresentative(AdminPrincipal admin) {
        if(!admin.representative() || admin.mustChangePassword()) throw new AuthException(AuthErrorCode.FORBIDDEN);
    }
    public java.util.List<java.util.Map<String,Object>> accounts(AdminPrincipal admin) {
        requireRepresentative(admin);
        return jdbc.queryForList("select admin_number as \"adminNumber\",name,active,must_change_password as \"mustChangePassword\" from administrators order by admin_number");
    }
    @org.springframework.transaction.annotation.Transactional
    public String create(AdminPrincipal admin,String number,String name) {
        requireRepresentative(admin);
        if(number==null||!number.matches("[0-9]{3}")||number.equals("000")||name==null||name.isBlank()||name.length()>80) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        byte[] bytes=new byte[12];new SecureRandom().nextBytes(bytes);
        String temporary=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        if(jdbc.update("insert into administrators(admin_number,name,password_hash) values (?,?,?) on conflict do nothing",number,name.strip(),AdminPassword.hash(temporary))!=1) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        return temporary;
    }
    @org.springframework.transaction.annotation.Transactional
    public void update(AdminPrincipal admin,String number,String name,boolean active) {
        requireRepresentative(admin);
        if(number.equals("000")||name==null||name.isBlank()||name.length()>80) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        if(jdbc.update("update administrators set name=?,active=? where admin_number=?",name.strip(),active,number)!=1) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        if(!active)jdbc.update("update admin_sessions set revoked_at=? where admin_number=?",Timestamp.from(clock.instant()),number);
    }
    public java.util.List<java.util.Map<String,Object>> accessLog(AdminPrincipal admin) {
        requireRepresentative(admin);
        return jdbc.queryForList("select admin_number as \"adminNumber\",admin_name as name,channel,created_at as \"createdAt\",revoked_at as \"revokedAt\" from admin_sessions where admin_number is not null order by created_at desc limit 200");
    }

    public void logout(AdminPrincipal principal) {
        jdbc.update("update admin_sessions set revoked_at=? where session_id=?", Timestamp.from(clock.instant()), principal.sessionId());
    }
    public record Login(String token, AdminPrincipal principal) {
        @Override public String toString() { return "AdminLogin[redacted]"; }
    }
}
