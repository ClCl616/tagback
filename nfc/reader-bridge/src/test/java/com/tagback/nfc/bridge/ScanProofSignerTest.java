package com.tagback.nfc.bridge;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScanProofSignerTest {
    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    @Test
    void signsTheConfiguredBridgeIdTogetherWithThePhysicalTagRead() throws Exception {
        String uid = "04C8AB82492490";
        var proof = new ScanProofSigner(SECRET, "kiosk-1").sign(uid);
        String canonical = proof.bridgeId() + "\n" + uid + "\n" + proof.issuedAt() + "\n" + proof.nonce();
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));

        assertEquals("kiosk-1", proof.bridgeId());
        assertEquals(HexFormat.of().formatHex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))), proof.signature());
        assertTrue(BridgeEvent.tagRead(uid, proof).json().contains("\"bridgeId\":\"kiosk-1\""));
    }
}
