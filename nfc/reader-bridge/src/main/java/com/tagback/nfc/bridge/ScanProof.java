package com.tagback.nfc.bridge;

public record ScanProof(String bridgeId, long issuedAt, String nonce, String signature) {}
