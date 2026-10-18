package com.tagback.nfc.reader;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class MockReaderSourceTest {
    @Test
    void cyclesBetweenPresentAndRemovedWithoutHardware() {
        AtomicLong time = new AtomicLong();
        MockReaderSource source = new MockReaderSource("04:c8:ab:82:49:24:90",
                Duration.ofMillis(100), Duration.ofMillis(50), time::get);
        assertEquals(ReaderSnapshot.tag("04C8AB82492490"), source.poll());
        time.set(Duration.ofMillis(100).toNanos());
        assertEquals(ReaderSnapshot.empty(), source.poll());
        time.set(Duration.ofMillis(150).toNanos());
        assertEquals(ReaderSnapshot.tag("04C8AB82492490"), source.poll());
    }
}
