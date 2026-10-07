package com.tagback.exception;

import java.time.Instant;

public class AuthException extends RuntimeException {
    private final AuthErrorCode code;
    private final Instant retryAt;

    public AuthException(AuthErrorCode code) { this(code, null); }
    public AuthException(AuthErrorCode code, Instant retryAt) {
        super(code.message());
        this.code = code;
        this.retryAt = retryAt;
    }
    public AuthErrorCode code() { return code; }
    public Instant retryAt() { return retryAt; }
}
