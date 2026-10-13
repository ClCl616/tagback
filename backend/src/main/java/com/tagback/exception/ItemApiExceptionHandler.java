package com.tagback.exception;

import com.tagback.controller.ItemController;
import com.tagback.dto.ApiErrorResponse;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Domain and input failures are handled first by ApiExceptionHandler. */
@RestControllerAdvice(assignableTypes = ItemController.class)
@Order(1)
public class ItemApiExceptionHandler {
    private static final Logger logger = LoggerFactory.getLogger(ItemApiExceptionHandler.class);

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(RuntimeException exception) {
        // Record the failure type without logging request bodies or connection details.
        logger.error("Unexpected item API failure: {}", exception.getClass().getName());
        return ResponseEntity.internalServerError().body(new ApiErrorResponse(
                new ApiErrorResponse.Error("INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.", null)));
    }
}
