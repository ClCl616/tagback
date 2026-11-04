package com.tagback.domain.repository;

import java.util.UUID;

public interface NfcScanProofUseStore {
    boolean consume(UUID nonce, String uid);
}
