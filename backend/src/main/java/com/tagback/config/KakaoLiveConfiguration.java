package com.tagback.config;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/** Fail closed when an explicit live profile lacks separate production settings. */
@Configuration
@Profile(AuthProfiles.LIVE)
public class KakaoLiveConfiguration {
    public KakaoLiveConfiguration(@Value("${tagback.auth.common-hash-key:}") String common,
            @Value("${tagback.kakao.hmac-key:}") String hmac,
            @Value("${tagback.kakao.skill-secret:}") String skill,
            @Value("${tagback.kakao.bot-id:}") String bot,
            @Value("${tagback.auth.allowed-origins:}") String origins,
            @Value("${tagback.nfc.scan-secret:}") String nfc,
            @Value("${tagback.nfc.bridge-id:}") String bridge) {
        String[] keys = {common, hmac, skill, nfc};
        if (Arrays.stream(keys).anyMatch(key -> key == null || key.isBlank() || key.length() < 32)
                || new HashSet<>(Arrays.asList(keys)).size() != keys.length)
            throw new IllegalStateException("Live authentication and NFC require distinct configured secrets of at least 32 characters");
        if (bot == null || bot.isBlank() || bridge == null || bridge.isBlank())
            throw new IllegalStateException("Live authentication requires a bot ID and NFC bridge ID");
        if (origins == null || origins.isBlank() || Arrays.stream(origins.split(",", -1)).anyMatch(origin -> !httpsOrigin(origin.trim())))
            throw new IllegalStateException("Live authentication requires explicit HTTPS allowed origins");
    }

    private static boolean httpsOrigin(String origin) {
        try {
            URI uri = URI.create(origin);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null
                    && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                    && uri.getRawQuery() == null && uri.getRawFragment() == null
                    && (uri.getPort() == -1 || (uri.getPort() > 0 && uri.getPort() <= 65535));
        } catch (IllegalArgumentException e) { return false; }
    }
}
