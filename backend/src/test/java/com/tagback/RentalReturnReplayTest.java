package com.tagback;

import com.tagback.domain.entity.*;
import com.tagback.domain.repository.*;
import com.tagback.dto.rental.NfcScanProof;
import com.tagback.exception.RentalException;
import com.tagback.service.NfcScanProofVerifier;
import com.tagback.service.RentalReturnService;
import com.tagback.service.sms.SmsSecrets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RentalReturnReplayTest {
    private static final Instant NOW = Instant.parse("2026-10-14T03:00:00Z");
    private final ItemRepository items = mock(ItemRepository.class);
    private final RentalRepository rentals = mock(RentalRepository.class);
    private final NfcTagRepository tags = mock(NfcTagRepository.class);
    private final ItemStatusHistoryRepository history = mock(ItemStatusHistoryRepository.class);
    private final ReturnInspectionWriter inspections = mock(ReturnInspectionWriter.class);
    private final NfcScanProofVerifier verifier = mock(NfcScanProofVerifier.class);
    private final NfcScanProofUseStore uses = mock(NfcScanProofUseStore.class);
    private final NfcReturnScanTicketStore tickets = mock(NfcReturnScanTicketStore.class);
    private final RentalAuthorizationStore codes = mock(RentalAuthorizationStore.class);
    private final SmsSecrets secrets = mock(SmsSecrets.class);
    private final RentalReturnService service = new RentalReturnService(items, rentals, tags, history,
            inspections, verifier, uses, tickets, codes, secrets,
            Clock.fixed(NOW.plusSeconds(61), ZoneOffset.UTC));
    private final UUID ticketId = UUID.randomUUID();
    private final UUID nonce = UUID.randomUUID();
    private final NfcScanProof proof = new NfcScanProof("kiosk-1", "04A23B1C5D6E80", NOW.toEpochMilli(),
            nonce.toString(), "a".repeat(64));
    private Rental rental;

    @BeforeEach void setup() {
        var item = new Item("계산기", ItemStatus.AVAILABLE, new ItemType("계산기", null));
        ReflectionTestUtils.setField(item, "id", 10L);
        rental = new Rental(new User("+821033333333", "test", NOW), item, NOW, NOW.plusSeconds(7200));
        ReflectionTestUtils.setField(rental, "id", 20L);
        rental.markReturned(NOW.plusSeconds(60), ReturnCondition.NORMAL);
        var ticket = new NfcReturnScanTicketStore.Ticket(ticketId, "kiosk-1", proof.uid(), nonce,
                10L, 20L, NOW.plusSeconds(60), "hash");
        when(secrets.keyedHash("rental-code-lookup:123456")).thenReturn("hash");
        when(tickets.findRecentConsumed(eq(ticketId), any())).thenReturn(Optional.of(ticket));
        when(verifier.verifyForReplay(proof)).thenReturn(new NfcScanProofVerifier.VerifiedProof("kiosk-1", proof.uid(), nonce));
        when(rentals.findById(20L)).thenReturn(Optional.of(rental));
    }

    @Test void returnsStoredResultWithoutWritingAgain() {
        var result = service.returnItem(ticketId, proof, ReturnCondition.NORMAL, "123456");
        assertEquals(20L, result.rentalId());
        assertEquals(NOW.plusSeconds(60), result.returnedAt());
        assertEquals(ItemStatus.AVAILABLE, result.itemStatus());
        verifyNoInteractions(items, tags, history, inspections, uses);
        verify(tickets, never()).consume(any(), any());
    }

    @Test void changedConditionCannotClaimExistingReturn() {
        assertEquals("RENTAL_CHANGED", assertThrows(RentalException.class,
                () -> service.returnItem(ticketId, proof, ReturnCondition.DAMAGED, "123456")).code());
        verifyNoInteractions(items, tags, history, inspections, uses);
    }

    @Test void mismatchedSignedScanCannotClaimExistingReturn() {
        when(verifier.verifyForReplay(proof)).thenReturn(new NfcScanProofVerifier.VerifiedProof("kiosk-1", proof.uid(), UUID.randomUUID()));
        assertEquals("NFC_SCAN_REQUIRED", assertThrows(RentalException.class,
                () -> service.returnItem(ticketId, proof, ReturnCondition.NORMAL, "123456")).code());
        verifyNoInteractions(items, tags, history, inspections, uses);
    }

    @Test void anotherCodeCannotReplayTheReturn() {
        when(secrets.keyedHash("rental-code-lookup:654321")).thenReturn("other-hash");
        assertEquals("RETURN_CODE_INVALID", assertThrows(RentalException.class,
                () -> service.returnItem(ticketId, proof, ReturnCondition.NORMAL, "654321")).code());
        verifyNoInteractions(items, tags, history, inspections, uses, codes);
    }
}
