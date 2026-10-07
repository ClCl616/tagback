package com.tagback.controller;

import com.tagback.config.AdminOnly;
import com.tagback.dto.ApiErrorResponse;
import com.tagback.dto.tag.RegisterTagRequest;
import com.tagback.dto.tag.TagRegistrationResponse;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagLifecycleService;
import com.tagback.service.TagRegistrationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/items")
public class TagLifecycleController {
    private final TagLifecycleService lifecycle;

    public TagLifecycleController(TagLifecycleService lifecycle) {
        this.lifecycle = lifecycle;
    }

    @AdminOnly
    @PutMapping("/{itemId}/tag")
    public ResponseEntity<TagRegistrationResponse> replace(@PathVariable Long itemId,
                                                            @RequestBody(required = false) RegisterTagRequest request) {
        if (request == null || request.uid() == null) {
            throw new TagRegistrationException(HttpStatus.BAD_REQUEST, "VALIDATION", "uid가 필요합니다.");
        }
        TagRegistrationService.RegistrationResult result = lifecycle.replace(itemId, request.uid());
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.response());
    }

    @AdminOnly
    @DeleteMapping("/{itemId}/tag")
    public ResponseEntity<Void> deactivate(@PathVariable Long itemId) {
        lifecycle.deactivate(itemId);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadableBody() {
        return ResponseEntity.badRequest().body(new ApiErrorResponse(new ApiErrorResponse.Error(
                "VALIDATION", "요청 본문이 올바르지 않습니다.", null)));
    }
}
