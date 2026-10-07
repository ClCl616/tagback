package com.tagback.exception;

import org.springframework.http.HttpStatus;

public enum AuthErrorCode {
    INVALID_INPUT(HttpStatus.BAD_REQUEST, "입력값을 확인해 주세요."),
    PIN_POLICY_VIOLATION(HttpStatus.BAD_REQUEST, "사용할 수 없는 PIN입니다."),
    PIN_MISMATCH(HttpStatus.UNAUTHORIZED, "PIN이 일치하지 않습니다."),
    PIN_RETRY_WAIT(HttpStatus.TOO_MANY_REQUESTS, "잠시 후 다시 시도해 주세요."),
    PIN_LOGIN_BLOCKED(HttpStatus.FORBIDDEN, "계정 복구가 필요합니다."),
    SMS_CODE_MISMATCH(HttpStatus.BAD_REQUEST, "인증번호가 일치하지 않습니다."),
    SMS_CODE_EXPIRED(HttpStatus.GONE, "인증번호가 만료되었습니다."),
    SMS_ATTEMPTS_EXCEEDED(HttpStatus.FORBIDDEN, "인증번호 입력 횟수를 초과했습니다."),
    SMS_REQUEST_INVALIDATED(HttpStatus.CONFLICT, "사용할 수 없는 인증 요청입니다."),
    SMS_ALREADY_VERIFIED(HttpStatus.CONFLICT, "이미 인증된 요청입니다."),
    SMS_RESEND_WAIT(HttpStatus.TOO_MANY_REQUESTS, "재발송까지 기다려 주세요."),
    SMS_REQUEST_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "인증 요청 한도를 초과했습니다."),
    SMS_DELIVERY_FAILED(HttpStatus.SERVICE_UNAVAILABLE, "인증번호를 발송하지 못했습니다."),
    VERIFICATION_INVALID(HttpStatus.UNAUTHORIZED, "유효하지 않은 인증 결과입니다."),
    VERIFICATION_EXPIRED(HttpStatus.GONE, "인증 결과가 만료되었습니다."),
    VERIFICATION_CONSUMED(HttpStatus.CONFLICT, "이미 사용된 인증 결과입니다."),
    VERIFICATION_PURPOSE_MISMATCH(HttpStatus.FORBIDDEN, "인증 용도가 일치하지 않습니다."),
    PHONE_NUMBER_ALREADY_REGISTERED(HttpStatus.CONFLICT, "이미 등록된 전화번호입니다."),
    ACCOUNT_NOT_FOUND(HttpStatus.NOT_FOUND, "계정을 찾을 수 없습니다."),
    BROWSER_REGISTRATION_INVALID(HttpStatus.UNAUTHORIZED, "브라우저 등록이 유효하지 않습니다."),
    SESSION_REQUIRED(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다."),
    SESSION_EXPIRED(HttpStatus.UNAUTHORIZED, "로그인이 만료되었습니다."),
    SESSION_REPLACED(HttpStatus.UNAUTHORIZED, "다른 브라우저에서 로그인하여 종료되었습니다."),
    RECOVERY_ADDITIONAL_CHECK_REQUIRED(HttpStatus.FORBIDDEN, "추가 복구 확인이 필요합니다."),
    REAUTHENTICATION_REQUIRED(HttpStatus.UNAUTHORIZED, "재인증이 필요합니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "접근 권한이 없습니다."),
    IDEMPOTENCY_KEY_CONFLICT(HttpStatus.CONFLICT, "요청 식별자가 다른 요청에 사용되었습니다.");

    private final HttpStatus status;
    private final String message;

    AuthErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
    public HttpStatus status() { return status; }
    public String message() { return message; }
}
