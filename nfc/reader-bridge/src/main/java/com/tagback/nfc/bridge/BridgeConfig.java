package com.tagback.nfc.bridge;

import com.tagback.nfc.reader.UidNormalizer;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** Command-line options override environment variables. */
public record BridgeConfig(int port, String origin, String readerName, String mockUid,
                           long pollMillis, long mockHoldMillis, long mockGapMillis) {
    private static final Set<String> OPTIONS = Set.of(
            "port", "origin", "reader", "mock-uid", "poll-ms", "mock-hold-ms", "mock-gap-ms");

    public static BridgeConfig parse(String[] args, Map<String, String> environment) {
        Map<String, String> options = new HashMap<>();
        for (String arg : args) {
            if (!arg.startsWith("--") || !arg.contains("=")) {
                throw new IllegalArgumentException("Use --name=value options");
            }
            int separator = arg.indexOf('=');
            String key = arg.substring(2, separator);
            if (!OPTIONS.contains(key)) throw new IllegalArgumentException("Unknown option: " + key);
            options.put(key, arg.substring(separator + 1));
        }

        int port = Math.toIntExact(number(value(options, environment, "port", "NFC_BRIDGE_PORT", "8765"), 1, 65535));
        String origin = value(options, environment, "origin", "NFC_BRIDGE_ORIGIN", "http://localhost:5173");
        URI parsed = URI.create(origin);
        if (!("http".equals(parsed.getScheme()) || "https".equals(parsed.getScheme()))
                || parsed.getHost() == null || parsed.getUserInfo() != null
                || (parsed.getRawPath() != null && !parsed.getRawPath().isEmpty())
                || parsed.getRawQuery() != null || parsed.getRawFragment() != null) {
            throw new IllegalArgumentException("Origin must be an http(s) origin without path");
        }
        String reader = value(options, environment, "reader", "NFC_BRIDGE_READER", "ACR1552U");
        if (reader.isBlank()) throw new IllegalArgumentException("Reader name cannot be blank");
        String mock = value(options, environment, "mock-uid", "NFC_BRIDGE_MOCK_UID", "");
        if (!mock.isBlank()) mock = UidNormalizer.normalize(mock);
        long poll = number(value(options, environment, "poll-ms", "NFC_BRIDGE_POLL_MS", "250"), 50, 60_000);
        long hold = number(value(options, environment, "mock-hold-ms", "NFC_BRIDGE_MOCK_HOLD_MS", "2000"), 1, 3_600_000);
        long gap = number(value(options, environment, "mock-gap-ms", "NFC_BRIDGE_MOCK_GAP_MS", "1000"), 1, 3_600_000);
        return new BridgeConfig(port, origin, reader, mock, poll, hold, gap);
    }

    private static String value(Map<String, String> options, Map<String, String> environment,
                                String option, String variable, String fallback) {
        return options.getOrDefault(option, environment.getOrDefault(variable, fallback));
    }

    private static long number(String raw, long minimum, long maximum) {
        long value = Long.parseLong(raw);
        if (value < minimum || value > maximum) {
            throw new IllegalArgumentException("Number out of range: " + raw);
        }
        return value;
    }
}
