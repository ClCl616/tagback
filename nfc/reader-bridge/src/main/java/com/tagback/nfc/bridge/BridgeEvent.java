package com.tagback.nfc.bridge;

import java.util.Objects;

public record BridgeEvent(Type type, String uid) {
    public enum Type { TAG_READ, TAG_REMOVED, READER_CONNECTED, READER_DISCONNECTED }

    public BridgeEvent {
        Objects.requireNonNull(type);
        if ((type == Type.TAG_READ) != (uid != null)) {
            throw new IllegalArgumentException("Only TAG_READ has a UID");
        }
    }

    public static BridgeEvent tagRead(String uid) { return new BridgeEvent(Type.TAG_READ, uid); }
    public static BridgeEvent tagRemoved() { return new BridgeEvent(Type.TAG_REMOVED, null); }
    public static BridgeEvent connected() { return new BridgeEvent(Type.READER_CONNECTED, null); }
    public static BridgeEvent disconnected() { return new BridgeEvent(Type.READER_DISCONNECTED, null); }

    public String json() {
        return uid == null ? "{\"type\":\"" + type + "\"}"
                : "{\"type\":\"" + type + "\",\"uid\":\"" + uid + "\"}";
    }

    public String sse() {
        return "event: " + type + "\n" + "data: " + json() + "\n\n";
    }
}
