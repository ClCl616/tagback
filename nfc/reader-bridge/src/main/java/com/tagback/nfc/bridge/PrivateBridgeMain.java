package com.tagback.nfc.bridge;

import com.tagback.nfc.reader.PcscReaderSource;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Installed host transport: stdin startup frame, stdout JSON events, no listening socket. */
public final class PrivateBridgeMain {
    private PrivateBridgeMain() {}

    static String field(BufferedReader input) throws Exception {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1 && value != '\n') {
            if (line.length() >= 8192) throw new IllegalArgumentException("Invalid frame");
            line.append((char) value);
        }
        if (value == -1) throw new IllegalArgumentException("Incomplete frame");
        return line.toString();
    }

    static String decode(String value) {
        return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
    }

    public static void main(String[] args) {
        var polling = Executors.newSingleThreadScheduledExecutor();
        try (var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            if (!field(input).equals("TAGBACK_READER_V1")) throw new IllegalArgumentException("Invalid version");
            String bridgeId = decode(field(input));
            String readerName = decode(field(input));
            String secret = decode(field(input));
            if (readerName.isBlank() || readerName.length() > 200) throw new IllegalArgumentException("Invalid reader");
            var signer = new ScanProofSigner(secret, bridgeId);
            var engine = new BridgeEngine(new PcscReaderSource(readerName), event -> {
                System.out.println(event.json());
                System.out.flush();
            }, 2, uid -> BridgeEvent.tagRead(uid, signer.sign(uid)));
            polling.scheduleWithFixedDelay(engine::pollOnce, 0, 250, TimeUnit.MILLISECONDS);
            // EOF (parent exit) closes the bridge. Further input is not a command channel.
            while (input.read() != -1) { }
        } catch (Exception ignored) {
            System.err.println("READER_IPC_FAILED");
        } finally {
            polling.shutdownNow();
        }
    }
}
