package com.tagback;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.sql.DriverManager;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "TAGBACK_AUTH_SCHEMA_TEST", matches = "true")
class AuthMigrationIntegrationTest {
    @Test
    void upgradingExistingAccountPreservesIdAndLegacyHashWithoutMakingItAPin() throws Exception {
        String schema = "auth_migration_" + UUID.randomUUID().toString().replace("-", "");
        String url = "jdbc:postgresql://127.0.0.1:55439/tagback_auth_test";
        try (var connection = DriverManager.getConnection(url, "postgres", "")) {
            try {
                Flyway.configure().dataSource(url, "postgres", "").schemas(schema).defaultSchema(schema)
                        .target("7").load().migrate();
                try (var statement = connection.createStatement()) {
                    statement.execute("insert into " + schema + ".users(user_id, phone_number, password_hash) values (17, '010-1234-5678', 'legacy-test-hash')");
                }
                Flyway.configure().dataSource(url, "postgres", "").schemas(schema).defaultSchema(schema).load().migrate();
                try (var statement = connection.createStatement(); var result = statement.executeQuery(
                        "select user_id, phone_number, password_hash, pin_hash, pin_failed_count from " + schema + ".users")) {
                    assertTrue(result.next());
                    assertEquals(17, result.getLong("user_id"));
                    assertEquals("+821012345678", result.getString("phone_number"));
                    assertEquals("legacy-test-hash", result.getString("password_hash"));
                    assertNull(result.getString("pin_hash"));
                    assertEquals(0, result.getInt("pin_failed_count"));
                }
            } finally {
                // Only the uniquely generated schema in the isolated test database is removed.
                try (var statement = connection.createStatement()) {
                    statement.execute("drop schema if exists " + schema + " cascade");
                }
            }
        }
    }
}
