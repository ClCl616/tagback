package com.tagback.dto.rental;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.tagback.dto.item.StrictStringDeserializer;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import tools.jackson.databind.annotation.JsonDeserialize;

public final class RentalRequests {
    private RentalRequests() {}

    public record Checkout(
            @JsonDeserialize(using = StrictStringDeserializer.class)
            @NotBlank @Pattern(regexp = "[1-9][0-9]{0,18}") @DecimalMax("9223372036854775807") String itemId,
            @JsonDeserialize(using = StrictStringDeserializer.class)
            @NotBlank @Pattern(regexp = "[1-9][0-9]{0,18}") @DecimalMax("9223372036854775807") String itemTypeId) {
        @JsonAnySetter public void rejectUnknown(String name, Object value) {
            throw new IllegalArgumentException("Unknown checkout field");
        }
    }

    public record VerifyCode(
            @JsonDeserialize(using = StrictStringDeserializer.class)
            @NotBlank @Pattern(regexp = "[0-9]{6}") String code) {
        @JsonAnySetter public void rejectUnknown(String name, Object value) {
            throw new IllegalArgumentException("Unknown rental code field");
        }
    }

    public record IssueCode() {
        @JsonAnySetter public void rejectUnknown(String name, Object value) {
            throw new IllegalArgumentException("Code issuance takes no user input");
        }
    }
}
