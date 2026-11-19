package com.tagback.nfc.bridge;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.smartcardio.TerminalFactory;

/** Read-only inventory for the installed operator panel; never reads a tag or key. */
public final class ReaderInventoryMain {
    private ReaderInventoryMain() {}
    public static void main(String[] args) {
        try {
            System.out.println("TAGBACK_READERS_V1");
            for (var terminal : TerminalFactory.getDefault().terminals().list()) {
                System.out.println(Base64.getEncoder().encodeToString(terminal.getName().getBytes(StandardCharsets.UTF_8)));
            }
        } catch (Exception ignored) {
            System.err.println("READER_LIST_UNAVAILABLE");
            System.exit(2);
        }
    }
}
