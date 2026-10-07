package com.tagback.nfc.reader;

import java.util.HexFormat;
import java.util.Locale;
import javax.smartcardio.Card;
import javax.smartcardio.CardTerminal;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import javax.smartcardio.TerminalFactory;

/** Polls an ACR1552U-compatible PC/SC terminal; rescans terminals on every poll. */
public final class PcscReaderSource implements ReaderSource {
    private static final CommandAPDU READ_UID = new CommandAPDU(new byte[] {
            (byte) 0xFF, (byte) 0xCA, 0x00, 0x00, 0x00
    });
    private final String readerName;

    public PcscReaderSource(String readerName) {
        this.readerName = readerName.toLowerCase(Locale.ROOT);
    }

    @Override
    public ReaderSnapshot poll() {
        try {
            CardTerminal terminal = TerminalFactory.getDefault().terminals().list().stream()
                    .filter(candidate -> candidate.getName().toLowerCase(Locale.ROOT).contains(readerName))
                    .findFirst().orElse(null);
            if (terminal == null) return ReaderSnapshot.disconnected();
            if (!terminal.isCardPresent()) return ReaderSnapshot.empty();

            Card card = terminal.connect("*");
            try {
                ResponseAPDU response = card.getBasicChannel().transmit(READ_UID);
                if (response.getSW() != 0x9000 || response.getData().length == 0) {
                    throw new IllegalStateException("Reader did not return a UID (SW="
                            + Integer.toHexString(response.getSW()) + ")");
                }
                return ReaderSnapshot.tag(HexFormat.of().withUpperCase().formatHex(response.getData()));
            } finally {
                card.disconnect(false);
            }
        } catch (Exception exception) {
            // The next poll discovers a reconnected reader without restarting the bridge.
            return ReaderSnapshot.disconnected();
        }
    }
}
