package com.tagback.dto;

import java.time.Instant;

public record ApiErrorResponse(Error error) {
    public record Error(String code, String message, Instant retryAt) {}
}
