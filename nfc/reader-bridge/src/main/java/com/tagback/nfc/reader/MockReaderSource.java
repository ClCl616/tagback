package com.tagback.nfc.reader;

import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

/** Alternates tag-present and tag-absent periods without hardware. */
public final class MockReaderSource implements ReaderSource {
    private final String uid;
    private final long holdNanos;
    private final long gapNanos;
    private final LongSupplier nanoTime;
    private final long startedAt;

    public MockReaderSource(String uid, Duration hold, Duration gap) {
        this(uid, hold, gap, System::nanoTime);
    }

    public MockReaderSource(String uid, Duration hold, Duration gap, LongSupplier nanoTime) {
        this.uid = UidNormalizer.normalize(uid);
        this.holdNanos = Objects.requireNonNull(hold).toNanos();
        this.gapNanos = Objects.requireNonNull(gap).toNanos();
        if (holdNanos <= 0 || gapNanos <= 0) throw new IllegalArgumentException("Mock durations must be positive");
        this.nanoTime = Objects.requireNonNull(nanoTime);
        this.startedAt = nanoTime.getAsLong();
    }

    @Override
    public ReaderSnapshot poll() {
        long elapsed = Math.max(0, nanoTime.getAsLong() - startedAt);
        return elapsed % (holdNanos + gapNanos) < holdNanos
                ? ReaderSnapshot.tag(uid) : ReaderSnapshot.empty();
    }
}
