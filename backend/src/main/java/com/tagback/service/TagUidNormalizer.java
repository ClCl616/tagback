package com.tagback.service;

import com.tagback.exception.TagRegistrationException;
import org.springframework.http.HttpStatus;

import java.util.Locale;
import java.util.regex.Pattern;

public final class TagUidNormalizer {
    private static final Pattern VALID_UID = Pattern.compile("(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})");

    private TagUidNormalizer() {
    }

    public static String normalize(String rawUid) {
        if (rawUid == null) {
            throw new TagRegistrationException(HttpStatus.BAD_REQUEST, "VALIDATION", "uid가 필요합니다.");
        }
        String normalized = rawUid.strip().replaceAll("[\\s:-]", "").toUpperCase(Locale.ROOT);
        if (!VALID_UID.matcher(normalized).matches()) {
            throw new TagRegistrationException(HttpStatus.BAD_REQUEST, "INVALID_UID_FORMAT", "UID 형식이 올바르지 않습니다.");
        }
        return normalized;
    }
}
