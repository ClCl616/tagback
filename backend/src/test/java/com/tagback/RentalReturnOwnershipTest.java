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

class RentalReturnOwnershipTest {
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
            inspections, verifier, uses, tickets, codes, secrets, Clock.fixed(NOW, ZoneOffset.UTC));
    private final UUID ticketId = UUID.randomUUID();
    private final UUID nonce = UUID.randomUUID();
    private final NfcScanProof proof = new NfcScanProof("kiosk-1", "04A23B1C5D6E80", NOW.toEpochMilli(),
            nonce.toString(), "a".repeat(64));
    private NfcReturnScanTicketStore.Ticket ticket;
    private Rental rental;
    private Item item;

    @BeforeEach void setup() {
        var user = new User("+821033333333", "test", NOW);
        ReflectionTestUtils.setField(user, "id", 77L);
        item = new Item("계산기", ItemStatus.RENTED, new ItemType("계산기", null));
        ReflectionTestUtils.setField(item, "id", 10L);
        rental = new Rental(user, item, NOW.minusSeconds(3600), NOW.plusSeconds(3600));
        ReflectionTestUtils.setField(rental, "id", 20L);
        ticket = new NfcReturnScanTicketStore.Ticket(ticketId, "kiosk-1", proof.uid(), nonce,
                10L, 20L, NOW.plusSeconds(60), null);
        when(tickets.findUsable(eq(ticketId), any())).thenReturn(Optional.of(ticket));
        when(verifier.verify(proof)).thenReturn(new NfcScanProofVerifier.VerifiedProof("kiosk-1", proof.uid(), nonce));
        when(secrets.keyedHash("rental-code-lookup:123456")).thenReturn("hash");
        when(rentals.findById(20L)).thenReturn(Optional.of(rental));
    }

    @Test void rejectsAnotherUsersCodeBeforeAnyReturnWrite() {
        when(codes.lockCodeByHash("hash")).thenReturn(Optional.of(
                new RentalAuthorizationStore.Code(UUID.randomUUID(), 88L, NOW.plusSeconds(60), null)));
        assertEquals("RETURN_CODE_INVALID", assertThrows(RentalException.class,
                () -> service.returnItem(ticketId, proof, ReturnCondition.NORMAL, "123456")).code());
        verify(items, never()).findForUpdate(any());
        verify(tickets, never()).consume(any(), any());
        verify(codes, never()).consumeCode(any(), any());
        assertNull(rental.getReturnedAt());
    }

    @Test void consumesOwnersCodeAndTicketWithTheReturn() {
        UUID codeId = UUID.randomUUID();
        when(codes.lockCodeByHash("hash")).thenReturn(Optional.of(
                new RentalAuthorizationStore.Code(codeId, 77L, NOW.plusSeconds(60), null)));
        when(items.findForUpdate(10L)).thenReturn(Optional.of(item));
        when(tags.findActiveByUid(proof.uid())).thenReturn(Optional.of(new NfcTag(proof.uid(), item)));
        when(rentals.findByItem_IdAndReturnedAtIsNull(10L)).thenReturn(Optional.of(rental));
        when(tickets.consume(eq(ticketId), any())).thenReturn(Optional.of(ticket));

        var result = service.returnItem(ticketId, proof, ReturnCondition.NORMAL, "123456");
        assertEquals(RentalStatus.RETURNED, result.rentalStatus());
        verify(codes).consumeCode(eq(codeId), any());
        verify(tickets).bindReturnCode(ticketId, "hash");
        verify(history).saveAndFlush(any());
        assertEquals(ItemStatus.AVAILABLE, item.getStatus());
    }
}
