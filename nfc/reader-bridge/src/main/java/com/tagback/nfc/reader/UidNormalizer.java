package com.tagback.nfc.reader;

import java.util.Locale;
import java.util.regex.Pattern;

/** Keep this rule aligned with backend TagUidNormalizer. */
public final class UidNormalizer {
    private static final Pattern VALID_UID = Pattern.compile("(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})");

    private UidNormalizer() {
    }

    public static String normalize(String rawUid) {
        if (rawUid == null) {
            throw new IllegalArgumentException("UID is required");
        }
        String normalized = rawUid.strip().replaceAll("[\\s:-]", "").toUpperCase(Locale.ROOT);
        if (!VALID_UID.matcher(normalized).matches()) {
            throw new IllegalArgumentException("UID must be 4, 7 or 10 hexadecimal bytes");
        }
        return normalized;
    }
}
