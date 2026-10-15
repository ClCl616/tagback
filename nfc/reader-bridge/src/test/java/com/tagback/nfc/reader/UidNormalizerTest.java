package com.tagback.nfc.reader;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class UidNormalizerTest {
    @Test
    void acceptsBackendUidLengthsAndSeparators() {
        assertEquals("A1B2C3D4", UidNormalizer.normalize(" a1:b2-c3 d4 "));
        assertEquals("04C8AB82492490", UidNormalizer.normalize("04:c8:ab:82:49:24:90"));
        assertEquals("0102030405060708090A", UidNormalizer.normalize("01-02-03-04-05-06-07-08-09-0a"));
    }

    @Test
    void rejectsInvalidHexLengthAndPrefix() {
        assertThrows(IllegalArgumentException.class, () -> UidNormalizer.normalize(null));
        assertThrows(IllegalArgumentException.class, () -> UidNormalizer.normalize("0xA1B2C3D4"));
        assertThrows(IllegalArgumentException.class, () -> UidNormalizer.normalize("G1B2C3D4"));
        assertThrows(IllegalArgumentException.class, () -> UidNormalizer.normalize("A1B2C3"));
    }
}
