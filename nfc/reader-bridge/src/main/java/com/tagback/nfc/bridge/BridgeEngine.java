package com.tagback.nfc.bridge;

import com.tagback.nfc.reader.ReaderSnapshot;
import com.tagback.nfc.reader.ReaderSource;
import com.tagback.nfc.reader.UidNormalizer;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.Function;

/** Converts repeated polling snapshots into state-transition events. */
public final class BridgeEngine {
    private final ReaderSource source;
    private final Consumer<BridgeEvent> events;
    private final int emptyPollsToRemove;
    private final Function<String, BridgeEvent> tagReadEvent;
    private Boolean connected;
    private String lastUid;
    private int emptyPolls;

    public BridgeEngine(ReaderSource source, Consumer<BridgeEvent> events) {
        this(source, events, 2);
    }

    public BridgeEngine(ReaderSource source, Consumer<BridgeEvent> events, int emptyPollsToRemove) {
        this(source, events, emptyPollsToRemove, BridgeEvent::tagRead);
    }

    public BridgeEngine(ReaderSource source, Consumer<BridgeEvent> events, int emptyPollsToRemove,
                        Function<String, BridgeEvent> tagReadEvent) {
        this.source = Objects.requireNonNull(source);
        this.events = Objects.requireNonNull(events);
        this.tagReadEvent = Objects.requireNonNull(tagReadEvent);
        if (emptyPollsToRemove < 1) throw new IllegalArgumentException("emptyPollsToRemove must be positive");
        this.emptyPollsToRemove = emptyPollsToRemove;
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
            emptyPolls = 0;
            return;
        }
        if (connected == null || !connected) events.accept(BridgeEvent.connected());
        connected = true;

        String uid = snapshot.uid() == null ? null : UidNormalizer.normalize(snapshot.uid());
        if (uid == null) {
            if (lastUid != null && ++emptyPolls >= emptyPollsToRemove) {
                events.accept(BridgeEvent.tagRemoved());
                lastUid = null;
                emptyPolls = 0;
            }
            return;
        }
        emptyPolls = 0;
        if (Objects.equals(lastUid, uid)) return;
        if (lastUid != null) events.accept(BridgeEvent.tagRemoved());
        lastUid = uid;
        if (uid != null) events.accept(tagReadEvent.apply(uid));
    }
}
