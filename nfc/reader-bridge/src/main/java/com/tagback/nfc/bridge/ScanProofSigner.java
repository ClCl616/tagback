package com.tagback.nfc.bridge;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class ScanProofSigner {
    private final byte[] secret;
    private final String bridgeId;

    public ScanProofSigner(String secret, String bridgeId) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        if (this.secret.length < 32) throw new IllegalArgumentException("NFC_SCAN_SECRET must be at least 32 bytes");
        if (bridgeId == null || !bridgeId.matches("[A-Za-z0-9._-]{1,64}"))
            throw new IllegalArgumentException("NFC_BRIDGE_ID is invalid");
        this.bridgeId = bridgeId;
    }

    public ScanProof sign(String uid) {
        long issuedAt = System.currentTimeMillis();
        String nonce = UUID.randomUUID().toString();
        String canonical = bridgeId + "\n" + uid + "\n" + issuedAt + "\n" + nonce;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            String signature = HexFormat.of().formatHex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
            return new ScanProof(bridgeId, issuedAt, nonce, signature);
        } catch (Exception exception) {
            throw new IllegalStateException("Could not sign NFC scan", exception);
        }
    }
}
