package com.tagback.domain.repository;

import java.util.UUID;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcNfcScanProofUseStore implements NfcScanProofUseStore {
    private final JdbcTemplate jdbc;

    public JdbcNfcScanProofUseStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean consume(UUID nonce, String uid) {
        return jdbc.update("insert into nfc_scan_proof_uses (nonce, tag_uid) values (?, ?) "
                + "on conflict (nonce) do nothing", nonce, uid) == 1;
    }
}
