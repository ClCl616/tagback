package com.tagback;

import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagUidNormalizer;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TagUidNormalizerTest {
    @Test
    void removesSeparatorsAndUppercasesUidWithoutReversingBytes() {
        assertEquals("04A23B1C5D6E80", TagUidNormalizer.normalize(" 04:a2:3b:1c:5d:6e:80 "));
        assertEquals("04A23B1C5D6E81", TagUidNormalizer.normalize("04-A2 3B-1C 5D-6E-81"));
    }

    @Test
    void rejectsInvalidLengthsNonHexAndPrefix() {
        for (String uid : new String[]{"123456", "04A23B1C5D6E8G", "0x04A23B1C5D6E80"}) {
            TagRegistrationException exception = assertThrows(TagRegistrationException.class,
                    () -> TagUidNormalizer.normalize(uid));
            assertEquals("INVALID_UID_FORMAT", exception.code());
        }
    }
}
