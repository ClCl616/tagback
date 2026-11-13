package com.tagback.nfc.bridge;

import org.junit.jupiter.api.Test;
import java.io.BufferedReader;
import java.io.StringReader;
import static org.junit.jupiter.api.Assertions.*;

class PrivateBridgeMainTest {
    @Test void readsFrameWithoutConsumingFollowingFields() throws Exception {
        var input = new BufferedReader(new StringReader("TAGBACK_READER_V1\nYWJj\n"));
        assertEquals("TAGBACK_READER_V1", PrivateBridgeMain.field(input));
        assertEquals("abc", PrivateBridgeMain.decode(PrivateBridgeMain.field(input)));
    }
    @Test void rejectsTruncatedAndOversizedFrames() {
        assertThrows(IllegalArgumentException.class, () -> PrivateBridgeMain.field(new BufferedReader(new StringReader("abc"))));
        assertThrows(IllegalArgumentException.class, () -> PrivateBridgeMain.field(new BufferedReader(new StringReader("a".repeat(8193) + "\n"))));
        assertThrows(IllegalArgumentException.class, () -> PrivateBridgeMain.decode("!invalid!"));
    }
}
