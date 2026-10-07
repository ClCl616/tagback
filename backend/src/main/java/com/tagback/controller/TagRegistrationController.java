package com.tagback.controller;

import com.tagback.config.AdminOnly;
import com.tagback.dto.ApiErrorResponse;
import com.tagback.dto.tag.RegisterTagRequest;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagRegistrationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/items")
public class TagRegistrationController {
    private final TagRegistrationService registrationService;

    public TagRegistrationController(TagRegistrationService registrationService) {
        this.registrationService = registrationService;
    }

    @AdminOnly
    @PostMapping("/{itemId}/tag")
    public ResponseEntity<TagRegistrationResponse> register(@PathVariable Long itemId,
                                                             @RequestBody(required = false) RegisterTagRequest request) {
        if (request == null || request.uid() == null) {
            throw new TagRegistrationException(HttpStatus.BAD_REQUEST, "VALIDATION", "uid가 필요합니다.");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(registrationService.register(itemId, request.uid()));
    }

    @ExceptionHandler(TagRegistrationException.class)
    public ResponseEntity<ApiErrorResponse> handleTagRegistration(TagRegistrationException exception) {
        return ResponseEntity.status(exception.status())
                .body(new ApiErrorResponse(new ApiErrorResponse.Error(
                        exception.code(), exception.getMessage(), null)));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadableBody() {
        return ResponseEntity.badRequest().body(new ApiErrorResponse(new ApiErrorResponse.Error(
                "VALIDATION", "요청 본문이 올바르지 않습니다.", null)));
    }
}
