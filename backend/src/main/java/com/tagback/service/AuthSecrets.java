package com.tagback.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
public class AuthSecrets {
    private final SecureRandom random = new SecureRandom();
    private final byte[] key;

    public AuthSecrets(@Value("${tagback.auth.hash-key:${tagback.auth.sms-hash-key:}}") String key) {
        if (key == null || (!key.isEmpty() && key.length() < 32)) throw new IllegalArgumentException("Authentication hash key must contain at least 32 characters");
        this.key = key.getBytes(StandardCharsets.UTF_8);
    }

    public String generateToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public String keyedHash(String value) {
        if (key.length < 32) throw new com.tagback.exception.AuthException(com.tagback.exception.AuthErrorCode.OAUTH_NOT_CONFIGURED);
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException exception) {
            throw new IllegalStateException("Cannot initialize authentication hashing", exception);
        }
    }

    public String tokenHash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException exception) {
            throw new IllegalStateException("Cannot initialize token hashing", exception);
        }
    }
}
