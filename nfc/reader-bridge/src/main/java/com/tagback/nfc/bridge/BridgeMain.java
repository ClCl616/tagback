package com.tagback.nfc.bridge;

import com.tagback.nfc.reader.MockReaderSource;
import com.tagback.nfc.reader.PcscReaderSource;
import com.tagback.nfc.reader.ReaderSource;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class BridgeMain {
    private BridgeMain() {
    }

    public static void main(String[] args) throws Exception {
        BridgeConfig config = BridgeConfig.parse(args, System.getenv());
        ReaderSource reader = config.mockUid().isEmpty()
                ? new PcscReaderSource(config.readerName())
                : new MockReaderSource(config.mockUid(), Duration.ofMillis(config.mockHoldMillis()),
                        Duration.ofMillis(config.mockGapMillis()));
        SseServer server = new SseServer(config.port(), config.origin(), config.pingMillis());
        ScheduledExecutorService polling = Executors.newSingleThreadScheduledExecutor();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            polling.shutdownNow();
            server.close();
        }));
        server.start();
        ScanProofSigner signer = new ScanProofSigner(config.scanSecret(), config.bridgeId());
        java.util.function.Function<String, BridgeEvent> tagReadEvent = config.mockUid().isEmpty()
                ? uid -> BridgeEvent.tagRead(uid, signer.sign(uid))
                : BridgeEvent::tagRead;
        BridgeEngine engine = new BridgeEngine(reader, server::publish, config.emptyPollsToRemove(),
                tagReadEvent);
        polling.scheduleWithFixedDelay(engine::pollOnce, 0, config.pollMillis(), TimeUnit.MILLISECONDS);
        System.out.println("Reader bridge listening on http://127.0.0.1:" + server.port() + "/events"
                + (config.mockUid().isEmpty() ? " (PC/SC)" : " (mock)"));
        new CountDownLatch(1).await();
    }
}
