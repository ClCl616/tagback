package com.tagback.dto.item;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.annotation.JsonDeserialize;

public final class TagRequests {
    private TagRequests() {}

    public record Assign(
            @JsonDeserialize(using = StrictStringDeserializer.class)
            @NotBlank @Size(max = 100) String tagUid) {
        public Assign {
            tagUid = tagUid == null ? null : tagUid.strip();
        }

        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException("Unknown tag field");
        }
    }
}
