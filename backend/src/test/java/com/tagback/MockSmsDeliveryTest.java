package com.tagback;

import com.tagback.dto.auth.SmsPurpose;
import com.tagback.service.sms.MockSmsDelivery;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class MockSmsDeliveryTest {
    private final Instant now = Instant.parse("2026-11-18T00:00:00Z");
    private final MockSmsDelivery delivery = new MockSmsDelivery(Clock.fixed(now, ZoneOffset.UTC));

    @BeforeEach void begin() { TransactionSynchronizationManager.initSynchronization(); }
    @AfterEach void cleanup() { TransactionSynchronizationManager.clearSynchronization(); }

    @Test void printsUsableCodeOnlyAfterCommitWithMaskedPhone(CapturedOutput output) {
        UUID id = UUID.randomUUID();
        delivery.deliverAfterCommit(id, "+821012345678", SmsPurpose.SIGNUP, "012345", now.plusSeconds(300));
        assertFalse(output.getOut().contains("[SMS-CONSOLE]"));
        assertTrue(delivery.findCode(id).isEmpty());
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        assertEquals("012345", delivery.findCode(id).orElseThrow());
        assertTrue(output.getOut().contains("[SMS-CONSOLE] phone=***5678 purpose=SIGNUP code=012345"));
        assertTrue(output.getOut().contains("expiresAt=2026-11-18T00:05:00Z requestId=" + id));
        assertFalse(output.getOut().contains("+821012345678"));
    }

    @Test void rollbackDoesNotExposeOrDeliverCode(CapturedOutput output) {
        UUID id = UUID.randomUUID();
        delivery.deliverAfterCommit(id, "+821012345678", SmsPurpose.PIN_RESET, "654321", now.plusSeconds(300));
        TransactionSynchronizationManager.getSynchronizations().forEach(
                synchronization -> synchronization.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        assertTrue(delivery.findCode(id).isEmpty());
        assertFalse(output.getOut().contains("[SMS-CONSOLE]"));
        assertFalse(output.getOut().contains("654321"));
    }
}
