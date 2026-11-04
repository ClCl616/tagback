package com.tagback.dto.rental;

public record NfcScanProof(String bridgeId, String uid, long issuedAt, String nonce, String signature) {}
