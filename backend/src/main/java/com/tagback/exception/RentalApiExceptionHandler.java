package com.tagback.exception;

import com.tagback.controller.RentalController;
import com.tagback.controller.RentalCodeController;
import com.tagback.dto.ApiErrorResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = {RentalController.class, RentalCodeController.class})
@Order(1)
public class RentalApiExceptionHandler {
    private static final Logger logger = LoggerFactory.getLogger(RentalApiExceptionHandler.class);
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ApiErrorResponse> unexpected(RuntimeException exception) {
        logger.error("Unexpected rental API failure: {}", exception.getClass().getName());
        return ResponseEntity.internalServerError().header("Cache-Control", "no-store").body(new ApiErrorResponse(
                new ApiErrorResponse.Error("INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.", null)));
    }
}
