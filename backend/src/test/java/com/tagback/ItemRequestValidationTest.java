package com.tagback;

import com.tagback.dto.item.ItemRequests;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ItemRequestValidationTest {
    @Test
    void rejectsExplicitNullButAcceptsOmittedPatchField() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            var patch = new ItemRequests.Update();
            assertFalse(validator.validate(patch).isEmpty());
            patch.setItemName("  우산 02  ");
            assertTrue(validator.validate(patch).isEmpty());
            assertEquals("우산 02", patch.getItemName());
            patch.setItemTypeId(null);
            assertFalse(validator.validate(patch).isEmpty());
        }
    }

    @Test
    void rejectsBlankNamesAndIdsOutsideDatabaseRange() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertTrue(validator.validate(new ItemRequests.Create(" 우산 ", "9223372036854775807")).isEmpty());
            assertFalse(validator.validate(new ItemRequests.Create("   ", "1")).isEmpty());
            assertFalse(validator.validate(new ItemRequests.Create("우산", "9223372036854775808")).isEmpty());
            assertFalse(validator.validate(new ItemRequests.Create("우산", "0")).isEmpty());
        }
    }
}
