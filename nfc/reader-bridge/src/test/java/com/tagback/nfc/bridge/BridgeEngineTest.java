package com.tagback.nfc.bridge;

import com.tagback.nfc.reader.ReaderSnapshot;
import com.tagback.nfc.reader.ReaderSource;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class BridgeEngineTest {
    @Test
    void suppressesRepeatedTagAndEmitsRemovalOnlyAfterAbsence() {
        List<BridgeEvent> events = new ArrayList<>();
        BridgeEngine engine = new BridgeEngine(new FakeReader(
                ReaderSnapshot.empty(), ReaderSnapshot.tag("04:c8:ab:82:49:24:90"),
                ReaderSnapshot.tag("04C8AB82492490"), ReaderSnapshot.empty(), ReaderSnapshot.empty()), events::add);
        for (int i = 0; i < 5; i++) engine.pollOnce();
        assertEquals(List.of(BridgeEvent.connected(), BridgeEvent.tagRead("04C8AB82492490"),
                BridgeEvent.tagRemoved()), events);
    }

    @Test
    void disconnectsOnceAndRecoversAutomaticallyWithSameTag() {
        List<BridgeEvent> events = new ArrayList<>();
        BridgeEngine engine = new BridgeEngine(new FakeReader(
                ReaderSnapshot.disconnected(), ReaderSnapshot.disconnected(),
                ReaderSnapshot.tag("A1B2C3D4"), ReaderSnapshot.disconnected(),
                ReaderSnapshot.tag("A1B2C3D4")), events::add);
        for (int i = 0; i < 5; i++) engine.pollOnce();
        assertEquals(List.of(BridgeEvent.disconnected(), BridgeEvent.connected(),
                BridgeEvent.tagRead("A1B2C3D4"), BridgeEvent.disconnected(),
                BridgeEvent.connected(), BridgeEvent.tagRead("A1B2C3D4")), events);
    }

    @Test
    void changingCardWithoutEmptyPollRemovesPreviousTagFirst() {
        List<BridgeEvent> events = new ArrayList<>();
        BridgeEngine engine = new BridgeEngine(new FakeReader(
                ReaderSnapshot.tag("A1B2C3D4"), ReaderSnapshot.tag("A1B2C3D5")), events::add);
        engine.pollOnce();
        engine.pollOnce();
        assertEquals(List.of(BridgeEvent.connected(), BridgeEvent.tagRead("A1B2C3D4"),
                BridgeEvent.tagRemoved(), BridgeEvent.tagRead("A1B2C3D5")), events);
    }

    @Test
    void transientEmptyReadDoesNotRemoveOrRereadSameTag() {
        List<BridgeEvent> events = new ArrayList<>();
        BridgeEngine engine = new BridgeEngine(new FakeReader(
                ReaderSnapshot.tag("A1B2C3D4"), ReaderSnapshot.empty(),
                ReaderSnapshot.tag("A1B2C3D4"), ReaderSnapshot.empty(),
                ReaderSnapshot.empty(), ReaderSnapshot.tag("A1B2C3D4")), events::add);
        for (int i = 0; i < 3; i++) engine.pollOnce();
        assertEquals(List.of(BridgeEvent.connected(), BridgeEvent.tagRead("A1B2C3D4")), events);
        for (int i = 0; i < 3; i++) engine.pollOnce();
        assertEquals(List.of(BridgeEvent.connected(), BridgeEvent.tagRead("A1B2C3D4"),
                BridgeEvent.tagRemoved(), BridgeEvent.tagRead("A1B2C3D4")), events);
    }

    @Test
    void configurableEmptyPollThresholdIsHonored() {
        List<BridgeEvent> events = new ArrayList<>();
        BridgeEngine engine = new BridgeEngine(new FakeReader(
                ReaderSnapshot.tag("A1B2C3D4"), ReaderSnapshot.empty(),
                ReaderSnapshot.empty(), ReaderSnapshot.empty()), events::add, 3);
        for (int i = 0; i < 3; i++) engine.pollOnce();
        assertEquals(List.of(BridgeEvent.connected(), BridgeEvent.tagRead("A1B2C3D4")), events);
        engine.pollOnce();
        assertEquals(List.of(BridgeEvent.connected(), BridgeEvent.tagRead("A1B2C3D4"),
                BridgeEvent.tagRemoved()), events);
    }

    private static final class FakeReader implements ReaderSource {
        private final ArrayDeque<ReaderSnapshot> snapshots;
        private FakeReader(ReaderSnapshot... snapshots) {
            this.snapshots = new ArrayDeque<>(List.of(snapshots));
        }
        @Override public ReaderSnapshot poll() { return snapshots.removeFirst(); }
    }
}
