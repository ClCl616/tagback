package com.tagback.config;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.exception.RentalException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.UUID;

public final class RentalHeaders {
    private RentalHeaders() {}
    public static String bearer(HttpServletRequest request) {
        var values = Collections.list(request.getHeaders("Authorization"));
        if (values.isEmpty()) throw RentalException.grantRequired();
        if (values.size() != 1 || !values.getFirst().matches("(?i:Bearer) [A-Za-z0-9_-]{43}")) {
            throw RentalException.grantInvalid();
        }
        return values.getFirst().substring(7);
    }
    public static UUID idempotencyKey(HttpServletRequest request) {
        var values = Collections.list(request.getHeaders("Idempotency-Key"));
        if (values.size() != 1 || !values.getFirst().matches(
                "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            throw new AuthException(AuthErrorCode.INVALID_INPUT);
        }
        return UUID.fromString(values.getFirst());
    }
}
