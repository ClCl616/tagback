package com.tagback;

import com.tagback.controller.TagRegistrationController;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagRegistrationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TagRegistrationControllerTest {
    private TagRegistrationService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(TagRegistrationService.class);
        mvc = MockMvcBuilders.standaloneSetup(new TagRegistrationController(service)).build();
    }

    @Test
    void returnsCreatedTagWithItemConnection() throws Exception {
        TagRegistrationResponse response = new TagRegistrationResponse(
                new TagRegistrationResponse.Tag(1L, "04A23B1C5D6E80", 12L, "ACTIVE", null));
        when(service.register(eq(12L), eq("04:a2:3b:1c:5d:6e:80"))).thenReturn(response);

        mvc.perform(post("/api/items/12/tag")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"04:a2:3b:1c:5d:6e:80\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tag.uid").value("04A23B1C5D6E80"))
                .andExpect(jsonPath("$.tag.itemId").value(12));
    }

    @Test
    void returnsValidationForMissingBodyOrUid() throws Exception {
        mvc.perform(post("/api/items/12/tag").contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        mvc.perform(post("/api/items/12/tag")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void returnsConflictWithoutExposingDatabaseDetails() throws Exception {
        when(service.register(eq(12L), eq("04A23B1C5D6E80")))
                .thenThrow(new TagRegistrationException(HttpStatus.CONFLICT,
                        "TAG_ALREADY_REGISTERED", "이미 등록된 태그입니다."));

        mvc.perform(post("/api/items/12/tag")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uid\":\"04A23B1C5D6E80\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TAG_ALREADY_REGISTERED"));
    }
}
