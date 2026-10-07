package com.tagback.nfc.bridge;

import com.tagback.nfc.reader.ReaderSnapshot;
import com.tagback.nfc.reader.ReaderSource;
import com.tagback.nfc.reader.UidNormalizer;
import java.util.Objects;
import java.util.function.Consumer;

/** Converts repeated polling snapshots into state-transition events. */
public final class BridgeEngine {
    private final ReaderSource source;
    private final Consumer<BridgeEvent> events;
    private Boolean connected;
    private String lastUid;

    public BridgeEngine(ReaderSource source, Consumer<BridgeEvent> events) {
        this.source = Objects.requireNonNull(source);
        this.events = Objects.requireNonNull(events);
    }

    public synchronized void pollOnce() {
        ReaderSnapshot snapshot;
        try {
            snapshot = Objects.requireNonNull(source.poll());
            if (snapshot.uid() != null) UidNormalizer.normalize(snapshot.uid());
        } catch (Exception exception) {
            snapshot = ReaderSnapshot.disconnected();
        }

        if (!snapshot.connected()) {
            if (connected == null || connected) events.accept(BridgeEvent.disconnected());
            connected = false;
            lastUid = null;
            return;
        }
        if (connected == null || !connected) events.accept(BridgeEvent.connected());
        connected = true;

        String uid = snapshot.uid() == null ? null : UidNormalizer.normalize(snapshot.uid());
        if (Objects.equals(lastUid, uid)) return;
        if (lastUid != null) events.accept(BridgeEvent.tagRemoved());
        lastUid = uid;
        if (uid != null) events.accept(BridgeEvent.tagRead(uid));
    }
}
