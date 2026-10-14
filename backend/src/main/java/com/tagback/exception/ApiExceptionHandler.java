package com.tagback.exception;

import com.tagback.dto.ApiErrorResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.core.annotation.Order;

@RestControllerAdvice
@Order(0)
public class ApiExceptionHandler {
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleMediaType(HttpMediaTypeNotSupportedException exception) {
        return ResponseEntity.status(415).body(new ApiErrorResponse(
                new ApiErrorResponse.Error("UNSUPPORTED_MEDIA_TYPE", "지원하지 않는 요청 형식입니다.", null)));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleMethod(HttpRequestMethodNotSupportedException exception) {
        var response = ResponseEntity.status(405);
        if (exception.getSupportedMethods() != null) {
            response.header("Allow", String.join(", ", exception.getSupportedMethods()));
        }
        return response.body(new ApiErrorResponse(
                new ApiErrorResponse.Error("METHOD_NOT_ALLOWED", "지원하지 않는 요청 메서드입니다.", null)));
    }

    @ExceptionHandler(ItemException.class)
    public ResponseEntity<ApiErrorResponse> handleItem(ItemException exception) {
        return ResponseEntity.status(exception.status()).body(new ApiErrorResponse(
                new ApiErrorResponse.Error(exception.code(), exception.getMessage(), null)));
    }

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<ApiErrorResponse> handleAuth(AuthException exception) {
        return ResponseEntity.status(exception.code().status()).body(new ApiErrorResponse(
                new ApiErrorResponse.Error(exception.code().name(), exception.code().message(), exception.retryAt())));
    }

    @ExceptionHandler(TagRegistrationException.class)
    public ResponseEntity<ApiErrorResponse> handleTag(TagRegistrationException exception) {
        return ResponseEntity.status(exception.status()).body(new ApiErrorResponse(
                new ApiErrorResponse.Error(exception.code(), exception.getMessage(), null)));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
            HandlerMethodValidationException.class, MethodArgumentTypeMismatchException.class,
            MissingRequestHeaderException.class})
    public ResponseEntity<ApiErrorResponse> handleInvalidInput(Exception exception) {
        // Never expose rejected values, request bodies, or parser diagnostics.
        return handleAuth(new AuthException(AuthErrorCode.INVALID_INPUT));
    }
}
