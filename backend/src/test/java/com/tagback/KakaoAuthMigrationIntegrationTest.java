package com.tagback;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
class KakaoAuthMigrationIntegrationTest {
    @Test void upgradePreservesDataAndEnforcesIdentityAndChallengeInvariants() throws Exception {
        String schema = "kakao_migration_" + UUID.randomUUID().toString().replace("-", "");
        String url = "jdbc:postgresql://127.0.0.1:55439/tagback_auth_test";
        try (var db = DriverManager.getConnection(url, "postgres", "")) {
            try {
                Flyway.configure().dataSource(url, "postgres", "").schemas(schema).defaultSchema(schema).target("20").load().migrate();
                try (var s = db.createStatement()) {
                    s.execute("SET search_path TO " + schema);
                    s.execute("INSERT INTO users(user_id,phone_number,password_hash) VALUES (101,'+821011111111','legacy'),(102,'+821022222222','legacy')");
                    s.execute("INSERT INTO sms_request_gates(phone_number) VALUES ('+821011111111')");
                }
                Flyway.configure().dataSource(url, "postgres", "").schemas(schema).defaultSchema(schema).load().migrate();
                try (var s = db.createStatement()) {
                    try (var r = s.executeQuery("SELECT (SELECT count(*) FROM users WHERE phone_number IS NOT NULL), (SELECT count(*) FROM sms_request_gates)")) {
                        assertTrue(r.next()); assertEquals(2, r.getInt(1)); assertEquals(1, r.getInt(2));
                    }
                    s.execute("INSERT INTO users(user_id,phone_number,password_hash) VALUES (103,NULL,'legacy'),(104,NULL,'legacy')");
                    s.execute("INSERT INTO kakao_bot_identities(user_id,bot_id,bot_user_key) VALUES (101,'bot-a','key-a')");
                    assertThrows(SQLException.class, () -> s.execute("INSERT INTO kakao_bot_identities(user_id,bot_id,bot_user_key) VALUES (102,'bot-a','key-a')"));
                    assertThrows(SQLException.class, () -> s.execute("INSERT INTO kakao_bot_identities(user_id,bot_id,bot_user_key) VALUES (101,'bot-b','key-b')"));
                    s.execute("INSERT INTO kakao_bot_identities(user_id,bot_id,bot_user_key) VALUES (102,'bot-b','key-a')");
                    String id = UUID.randomUUID().toString();
                    String insert = "INSERT INTO kakao_auth_challenges(challenge_id,purpose,status,code_hmac,browser_proof_hmac,created_at,expires_at) VALUES ('" + id + "','SIGNUP','PENDING',decode(repeat('11',32),'hex'),decode(repeat('22',32),'hex'),now(),now()+interval '5 minutes')";
                    s.execute(insert);
                    assertThrows(SQLException.class, () -> s.execute(insert.replace(id, UUID.randomUUID().toString())));
                    assertThrows(SQLException.class, () -> s.execute("UPDATE kakao_auth_challenges SET status='CONSUMED',consumed_at=now() WHERE challenge_id='" + id + "'"));
                    s.execute("UPDATE kakao_auth_challenges SET status='VERIFIED',bot_id='bot-a',bot_user_key='key-a',verified_at=now() WHERE challenge_id='" + id + "'");
                    s.execute("UPDATE kakao_auth_challenges SET status='CONSUMED',consumed_at=now() WHERE challenge_id='" + id + "'");
                    assertThrows(SQLException.class, () -> s.execute("UPDATE kakao_auth_challenges SET purpose='PHONE_CHANGE' WHERE challenge_id='" + id + "'"));
                    s.execute(insert.replace(id, UUID.randomUUID().toString()));
                }
            } finally {
                try (var s = db.createStatement()) { s.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE"); }
            }
        }
    }
}
