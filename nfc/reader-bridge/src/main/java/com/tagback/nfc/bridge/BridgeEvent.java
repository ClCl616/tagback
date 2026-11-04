package com.tagback.nfc.bridge;

import java.util.Objects;

public record BridgeEvent(Type type, String uid, ScanProof proof) {
    public enum Type { TAG_READ, TAG_REMOVED, READER_CONNECTED, READER_DISCONNECTED }

    public BridgeEvent {
        Objects.requireNonNull(type);
        if ((type == Type.TAG_READ) != (uid != null) || (proof != null && type != Type.TAG_READ)) {
            throw new IllegalArgumentException("Only TAG_READ has scan data");
        }
    }

    public static BridgeEvent tagRead(String uid) { return tagRead(uid, null); }
    public static BridgeEvent tagRead(String uid, ScanProof proof) { return new BridgeEvent(Type.TAG_READ, uid, proof); }
    public static BridgeEvent tagRemoved() { return new BridgeEvent(Type.TAG_REMOVED, null, null); }
    public static BridgeEvent connected() { return new BridgeEvent(Type.READER_CONNECTED, null, null); }
    public static BridgeEvent disconnected() { return new BridgeEvent(Type.READER_DISCONNECTED, null, null); }

    public String json() {
        if (uid == null) return "{\"type\":\"" + type + "\"}";
        String data = "{\"type\":\"" + type + "\",\"uid\":\"" + uid + "\"";
        if (proof != null) data += ",\"bridgeId\":\"" + proof.bridgeId() + "\",\"issuedAt\":" + proof.issuedAt() + ",\"nonce\":\""
                + proof.nonce() + "\",\"signature\":\"" + proof.signature() + "\"";
        return data + "}";
    }

    public String sse() {
        return "event: " + type + "\n" + "data: " + json() + "\n\n";
    }
}
