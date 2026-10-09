package com.tagback.dto.item;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.annotation.JsonDeserialize;

/** Controllers must use @Valid. IDs remain strings at the HTTP boundary. */
public final class ItemRequests {
    private ItemRequests() {}

    public record Create(
            @JsonDeserialize(using = StrictStringDeserializer.class)
            @NotBlank @Size(max = 100) String itemName,
            @JsonDeserialize(using = StrictStringDeserializer.class)
            @NotBlank @Pattern(regexp = "[1-9][0-9]{0,18}")
            @DecimalMax("9223372036854775807") String itemTypeId) {
        public Create {
            itemName = itemName == null ? null : itemName.strip();
        }

        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException("Unknown item field");
        }
    }

    /** Presence flags distinguish omitted fields from explicit JSON null in PATCH. */
    public static final class Update {
        @Size(max = 100)
        @JsonDeserialize(using = StrictStringDeserializer.class)
        private String itemName;

        @Pattern(regexp = "[1-9][0-9]{0,18}")
        @DecimalMax("9223372036854775807")
        @JsonDeserialize(using = StrictStringDeserializer.class)
        private String itemTypeId;

        private boolean itemNameProvided;
        private boolean itemTypeIdProvided;

        public String getItemName() { return itemName; }
        public String getItemTypeId() { return itemTypeId; }

        public void setItemName(String itemName) {
            itemNameProvided = true;
            this.itemName = itemName == null ? null : itemName.strip();
        }

        public void setItemTypeId(String itemTypeId) {
            itemTypeIdProvided = true;
            this.itemTypeId = itemTypeId;
        }

        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException("Unknown item field");
        }

        @AssertTrue(message = "Provide at least one field; supplied values must not be null or blank")
        public boolean isValidPatch() {
            return (itemNameProvided || itemTypeIdProvided)
                    && (!itemNameProvided || (itemName != null && !itemName.isBlank()))
                    && (!itemTypeIdProvided || (itemTypeId != null && !itemTypeId.isBlank()));
        }
    }

    /** Status writes are isolated from the general item PATCH contract. */
    public static final class StatusChange {
        @NotBlank
        @Pattern(regexp = "AVAILABLE|INSPECTION|REPAIR")
        @JsonDeserialize(using = StrictStringDeserializer.class)
        private String status;

        @Size(max = 500)
        @JsonDeserialize(using = StrictStringDeserializer.class)
        private String reason;

        private boolean statusProvided;
        private boolean reasonProvided;

        public String getStatus() { return status; }
        public String getReason() { return reason; }

        public void setStatus(String status) {
            statusProvided = true;
            this.status = status;
        }

        public void setReason(String reason) {
            reasonProvided = true;
            this.reason = reason == null ? null : reason.strip();
        }

        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException("Unknown item status field");
        }

        @AssertTrue(message = "status is required and supplied reason must not be null")
        public boolean isValidStatusChange() {
            return statusProvided && (!reasonProvided || reason != null);
        }
    }
}
