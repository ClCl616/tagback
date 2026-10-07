package com.tagback.service;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.stereotype.Service;

@Service
public class PinService {
    private static final int ITERATIONS = 600_000;
    private final SecureRandom random = new SecureRandom();

    public void validate(String pin) {
        if (pin == null || !pin.matches("[0-9]{6}")) reject();
        boolean ascending = true;
        boolean descending = true;
        int repeated = 1;
        for (int i = 1; i < pin.length(); i++) {
            int previous = pin.charAt(i - 1) - '0';
            int current = pin.charAt(i) - '0';
            ascending &= current == (previous + 1) % 10;
            descending &= current == (previous + 9) % 10;
            repeated = current == previous ? repeated + 1 : 1;
            if (repeated >= 3) reject();
        }
        if (ascending || descending) reject();
    }

    public String hash(String pin) {
        validate(pin);
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        return "pbkdf2-sha256$" + ITERATIONS + "$" + Base64.getEncoder().encodeToString(salt)
                + "$" + Base64.getEncoder().encodeToString(derive(pin, salt, ITERATIONS));
    }

    public boolean matches(String pin, String encoded) {
        if (pin == null || !pin.matches("[0-9]{6}") || encoded == null) return false;
        try {
            String[] parts = encoded.split("\\$");
            if (parts.length != 4 || !parts[0].equals("pbkdf2-sha256")) return false;
            int iterations = Integer.parseInt(parts[1]);
            if (iterations < ITERATIONS || iterations > 2_000_000) return false;
            byte[] salt = Base64.getDecoder().decode(parts[2]);
            byte[] expected = Base64.getDecoder().decode(parts[3]);
            if (salt.length != 16 || expected.length != 32) return false;
            return MessageDigest.isEqual(expected, derive(pin, salt, iterations));
        } catch (IllegalArgumentException exception) { return false; }
    }

    private byte[] derive(String pin, byte[] salt, int iterations) {
        var spec = new PBEKeySpec(pin.toCharArray(), salt, iterations, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        catch (java.security.GeneralSecurityException exception) { throw new IllegalStateException("PIN hashing unavailable", exception); }
        finally { spec.clearPassword(); }
    }

    private void reject() { throw new AuthException(AuthErrorCode.PIN_POLICY_VIOLATION); }
}
