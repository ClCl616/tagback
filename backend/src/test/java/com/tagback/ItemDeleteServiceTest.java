package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.repository.*;
import com.tagback.exception.ItemException;
import com.tagback.service.ItemService;
import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.Optional;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ItemDeleteServiceTest {
    private final ItemRepository items = mock(ItemRepository.class);
    private final ItemService service = new ItemService(items, mock(ItemTypeRepository.class),
            mock(NfcTagRepository.class), mock(EntityManager.class));
    private final Item item = mock(Item.class);

    @BeforeEach void setup() { when(items.findForUpdate(10L)).thenReturn(Optional.of(item)); }

    @Test void deletesAndFlushesUnreferencedItem() {
        service.delete(10L);
        var order = inOrder(items);
        order.verify(items).findForUpdate(10L);
        order.verify(items).hasDeletionReferences(10L);
        order.verify(items).delete(item);
        order.verify(items).flush();
    }

    @Test void refusesReferencedAndMissingItems() {
        when(items.hasDeletionReferences(10L)).thenReturn(true);
        assertEquals("ITEM_DELETE_CONFLICT", assertThrows(ItemException.class, () -> service.delete(10L)).code());
        when(items.findForUpdate(99L)).thenReturn(Optional.empty());
        assertEquals("ITEM_NOT_FOUND", assertThrows(ItemException.class, () -> service.delete(99L)).code());
        verify(items, never()).delete(any(Item.class));
        verify(items, never()).flush();
    }

    @Test void translatesOnlyKnownItemForeignKeyViolations() {
        for (String constraint : List.of("fk_nfc_tags_item", "fk_rentals_item", "fk_inspections_item")) {
            var cause = mock(ConstraintViolationException.class);
            when(cause.getSQLState()).thenReturn("23503");
            when(cause.getConstraintName()).thenReturn(constraint);
            doThrow(new DataIntegrityViolationException("FK", cause)).when(items).flush();
            assertEquals("ITEM_DELETE_CONFLICT", assertThrows(ItemException.class, () -> service.delete(10L)).code());
        }
    }

    @Test void doesNotMislabelUnrelatedDatabaseErrorsAsDeleteConflicts() {
        var failure = new DataIntegrityViolationException("unrelated");
        doThrow(failure).when(items).flush();
        assertSame(failure, assertThrows(DataIntegrityViolationException.class, () -> service.delete(10L)));
        var cause = mock(ConstraintViolationException.class);
        when(cause.getSQLState()).thenReturn("23503");
        var unknown = new DataIntegrityViolationException("unknown constraint", cause);
        doThrow(unknown).when(items).flush();
        assertSame(unknown, assertThrows(DataIntegrityViolationException.class, () -> service.delete(10L)));
    }
}
