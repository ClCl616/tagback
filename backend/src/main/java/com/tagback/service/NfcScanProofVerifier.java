package com.tagback.service;

import com.tagback.dto.rental.NfcScanProof;
import com.tagback.exception.RentalException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class NfcScanProofVerifier {
    private static final long MAX_AGE_MILLIS = 60_000;
    private final byte[] secret;
    private final String expectedBridgeId;
    private final Clock clock;

    public NfcScanProofVerifier(@Value("${tagback.nfc.scan-secret:}") String secret,
                                @Value("${tagback.nfc.bridge-id:}") String expectedBridgeId, Clock clock) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.expectedBridgeId = expectedBridgeId;
        this.clock = clock;
    }

    public VerifiedProof verify(NfcScanProof proof) {
        return verify(proof, true);
    }

    public VerifiedProof verifyForReplay(NfcScanProof proof) {
        return verify(proof, false);
    }

    private VerifiedProof verify(NfcScanProof proof, boolean checkAge) {
        try {
            if (proof == null || secret.length < 32 || expectedBridgeId.isBlank()
                    || !expectedBridgeId.equals(proof.bridgeId()) || proof.uid() == null || proof.nonce() == null
                    || proof.signature() == null) throw new IllegalArgumentException();
            String uid = TagUidNormalizer.normalize(proof.uid());
            UUID nonce = UUID.fromString(proof.nonce());
            long now = clock.millis();
            if (checkAge && (proof.issuedAt() > now + 5_000 || now - proof.issuedAt() > MAX_AGE_MILLIS)) {
                throw new IllegalArgumentException();
            }
            byte[] supplied = HexFormat.of().parseHex(proof.signature());
            byte[] expected = hmac(proof.bridgeId() + "\n" + uid + "\n" + proof.issuedAt() + "\n" + nonce);
            if (!MessageDigest.isEqual(supplied, expected)) throw new IllegalArgumentException();
            return new VerifiedProof(proof.bridgeId(), uid, nonce);
        } catch (RuntimeException exception) {
            throw RentalException.invalidScanProof();
        } catch (Exception exception) {
            throw RentalException.invalidScanProof();
        }
    }

    private byte[] hmac(String value) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
    }

    public record VerifiedProof(String bridgeId, String uid, UUID nonce) {}
}
