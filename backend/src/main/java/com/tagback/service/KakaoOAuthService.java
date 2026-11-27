package com.tagback.service;

import com.tagback.config.AuthProperties;
import com.tagback.exception.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class KakaoOAuthService {
    private final JdbcTemplate db;
    private final AuthSecrets secrets;
    private final KakaoClient kakao;
    private final Clock clock;
    private final AuthProperties policy;
    private final TransactionTemplate tx;
    public KakaoOAuthService(JdbcTemplate db, AuthSecrets secrets, KakaoClient kakao, Clock clock,
                             AuthProperties policy, PlatformTransactionManager manager) {
        this.db=db; this.secrets=secrets; this.kakao=kakao; this.clock=clock; this.policy=policy;
        tx=new TransactionTemplate(manager);
    }
    public record Start(String url, String browser) {
        @Override public String toString() { return "Start[redacted]"; }
    }
    public record Result(boolean needsSignup, String nickname, String next, String userId) {}
    public record Issued(String token, Instant expires, String next, String userId) {
        @Override public String toString() { return "Issued[redacted]"; }
    }
    private record Attempt(String state, String browser, String next, Long kakaoId, String nickname, Instant expires) {}

    public static String safeNext(String value) {
        // Only explicit local user destinations. No encoded slashes, fragments or auth routes.
        if (value != null && value.length() <= 300 && value.matches("/mobile(?:/(?:items|rentals|history)(?:/[0-9]+)?|/code|/account)?(?:\\?[a-zA-Z0-9_=&+.%~-]*)?"))
            return value;
        return "/mobile";
    }
    public Start start(String previousBrowser, String next, boolean switchAccount) {
        return start(previousBrowser,next,switchAccount,"internal");
    }
    public Start start(String previousBrowser, String next, boolean switchAccount, String address) {
        String state=secrets.generateToken(), browser=secrets.generateToken();
        String url=kakao.authorize(state, switchAccount); // Fail before storing anything if unconfigured.
        var window=clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MINUTES);
        boolean allowed=Boolean.TRUE.equals(tx.execute(status -> {
            db.update("delete from oauth_start_limits where window_at<?",stamp(window.minusSeconds(600)));
            int global=countStart(secrets.keyedHash("oauth-start-global"),window);
            int local=countStart(secrets.keyedHash("oauth-start-address:"+address),window);
            return global<=300 && local<=30;
        }));
        if(!allowed) throw new AuthException(AuthErrorCode.OAUTH_LIMITED,window.plusSeconds(60));
        invalidate(previousBrowser);
        db.update("delete from oauth_attempts where expires_at < ?", stamp(clock.instant()));
        db.update("insert into oauth_attempts(state_hash,browser_hash,next_path,expires_at) values (?,?,?,?)",
                secrets.tokenHash(state), secrets.tokenHash(browser), safeNext(next), stamp(clock.instant().plusSeconds(600)));
        return new Start(url,browser);
    }
    private int countStart(String hash,Instant window) {
        return db.queryForObject("insert into oauth_start_limits(scope_hash,window_at,attempts) values (?,?,1) on conflict(scope_hash,window_at) do update set attempts=oauth_start_limits.attempts+1 returning attempts",Integer.class,hash,stamp(window));
    }
    public void invalidate(String browser) {
        if (validToken(browser)) tx.executeWithoutResult(status -> {
            // DELETE waits for an in-flight completion's row lock. Revoke after it commits,
            // so a delayed old-account Set-Cookie response can never restore that account.
            db.update("delete from oauth_attempts where browser_hash=?", secrets.tokenHash(browser));
            db.update("update login_sessions set revoked_at=?,revoked_reason='LOGOUT' where oauth_flow_hash=? and revoked_at is null",
                    stamp(clock.instant()),secrets.tokenHash(browser));
        });
    }
    public Result callback(String state, String browser, String code, String error) {
        if (!validToken(state) || !validToken(browser)) throw invalid();
        // Commit one-time consumption BEFORE contacting Kakao: failures/timeouts cannot replay a code.
        int claimed=db.update("update oauth_attempts set claimed=true where state_hash=? and browser_hash=? and claimed=false and expires_at>?",
                secrets.tokenHash(state),secrets.tokenHash(browser),stamp(clock.instant()));
        if (claimed != 1) throw invalid();
        if (error != null || code == null) { invalidate(browser); throw invalid(); }
        var identity=kakao.exchange(code);
        db.update("update oauth_attempts set kakao_user_id=?,nickname=? where state_hash=? and browser_hash=? and expires_at>?",
                identity.id(),identity.nickname(),secrets.tokenHash(state),secrets.tokenHash(browser),stamp(clock.instant()));
        return pending(browser);
    }
    public Result pending(String browser) {
        var a=attempt(browser,false);
        var ids=db.queryForList("select user_id from users where kakao_user_id=?",Long.class,a.kakaoId());
        return new Result(ids.isEmpty(),a.nickname(),a.next(),ids.isEmpty()?null:ids.getFirst().toString());
    }
    public Issued finish(String browser, String name, String occupation) {
        return tx.execute(status -> {
            var a=attempt(browser,true);
            // Serializes parallel first signups across different browsers; UNIQUE is the final invariant.
            db.queryForList("select pg_advisory_xact_lock(?)", a.kakaoId());
            var ids=db.queryForList("select user_id from users where kakao_user_id=? for update",Long.class,a.kakaoId());
            if (!a.expires().isAfter(clock.instant())) throw invalid(); // Recheck after lock waits.
            long userId;
            if (ids.isEmpty()) {
                if (name==null || name.strip().isEmpty() || name.strip().length()>40
                        || occupation==null || !Set.of("학생","교직원","기타").contains(occupation))
                    throw new AuthException(AuthErrorCode.INVALID_INPUT);
                userId=db.queryForObject("insert into users(kakao_user_id,name,occupation,role,created_at) values (?,?,?,'USER',?) returning user_id",
                        Long.class,a.kakaoId(),name.strip(),occupation,stamp(clock.instant()));
            } else userId=ids.getFirst(); // A replay never changes the stored profile.
            var now=clock.instant(); var absolute=now.plus(policy.sessionAbsoluteTimeout());
            // Preserve existing single-active-browser semantics and rotate credentials on every login.
            db.update("update login_sessions set revoked_at=?,revoked_reason='SESSION_REPLACED' where user_id=? and revoked_at is null",stamp(now),userId);
            db.update("update browser_registrations set revoked_at=? where user_id=? and revoked_at is null",stamp(now),userId);
            var registration=UUID.randomUUID(); String token=secrets.generateToken();
            db.update("insert into browser_registrations(browser_registration_id,user_id,registration_token_hash,expires_at,last_used_at,created_at) values (?,?,?,?,?,?)",
                    registration,userId,secrets.tokenHash(secrets.generateToken()),stamp(absolute),stamp(now),stamp(now));
            db.update("insert into login_sessions(login_session_id,user_id,browser_registration_id,session_token_hash,last_activity_at,idle_expires_at,absolute_expires_at,created_at) values (?,?,?,?,?,?,?,?)",
                    UUID.randomUUID(),userId,registration,secrets.tokenHash(token),stamp(now),stamp(now.plus(policy.sessionIdleTimeout())),stamp(absolute),stamp(now));
            db.update("update login_sessions set oauth_flow_hash=? where session_token_hash=?",a.browser(),secrets.tokenHash(token));
            db.update("update oauth_attempts set completed_user_id=? where state_hash=?",userId,a.state());
            return new Issued(token,absolute,a.next(),Long.toString(userId));
        });
    }
    private Attempt attempt(String browser, boolean lock) {
        if (!validToken(browser)) throw invalid();
        var rows=db.query("select * from oauth_attempts where browser_hash=? and expires_at>? and kakao_user_id is not null"+(lock?" for update":""),
                (r,n)->new Attempt(r.getString("state_hash"),r.getString("browser_hash"),r.getString("next_path"),r.getLong("kakao_user_id"),r.getString("nickname"),r.getTimestamp("expires_at").toInstant()),
                secrets.tokenHash(browser),stamp(clock.instant()));
        if(rows.size()!=1) throw invalid();
        return rows.getFirst();
    }
    private static boolean validToken(String value) {return value!=null && value.matches("[A-Za-z0-9_-]{43}");}
    private static Timestamp stamp(Instant time) {return Timestamp.from(time);}
    private static AuthException invalid() {return new AuthException(AuthErrorCode.OAUTH_INVALID);}
}
