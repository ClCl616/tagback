package com.tagback.nfc.reader;

public record ReaderSnapshot(boolean connected, String uid) {
    public ReaderSnapshot {
        if (!connected && uid != null) {
            throw new IllegalArgumentException("A disconnected reader cannot report a UID");
        }
    }

    public static ReaderSnapshot disconnected() {
        return new ReaderSnapshot(false, null);
    }

    public static ReaderSnapshot empty() {
        return new ReaderSnapshot(true, null);
    }

    public static ReaderSnapshot tag(String uid) {
        return new ReaderSnapshot(true, uid);
    }
}
