package com.tagback.exception;

import org.springframework.http.HttpStatus;

public enum AuthErrorCode {
    ADMIN_NOT_CONFIGURED(HttpStatus.SERVICE_UNAVAILABLE, "관리자 비밀번호가 설정되지 않았습니다."),
    ADMIN_PASSWORD_INVALID(HttpStatus.UNAUTHORIZED, "관리자 비밀번호가 일치하지 않습니다."),
    ADMIN_LOGIN_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "관리자 로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요."),
    INVALID_INPUT(HttpStatus.BAD_REQUEST, "입력값을 확인해 주세요."),
    PIN_POLICY_VIOLATION(HttpStatus.BAD_REQUEST, "사용할 수 없는 PIN입니다."),
    PIN_MISMATCH(HttpStatus.UNAUTHORIZED, "PIN이 일치하지 않습니다."),
    PIN_RETRY_WAIT(HttpStatus.TOO_MANY_REQUESTS, "잠시 후 다시 시도해 주세요."),
    PIN_LOGIN_BLOCKED(HttpStatus.FORBIDDEN, "계정 복구가 필요합니다."),
    KAKAO_REQUEST_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."),
    VERIFICATION_INVALID(HttpStatus.UNAUTHORIZED, "유효하지 않은 인증 결과입니다."),
    VERIFICATION_EXPIRED(HttpStatus.GONE, "인증 결과가 만료되었습니다."),
    VERIFICATION_CONSUMED(HttpStatus.CONFLICT, "이미 사용된 인증 결과입니다."),
    VERIFICATION_PURPOSE_MISMATCH(HttpStatus.FORBIDDEN, "인증 용도가 일치하지 않습니다."),
    KAKAO_IDENTITY_ALREADY_REGISTERED(HttpStatus.CONFLICT, "이미 가입된 카카오 계정입니다. 로그인하거나 PIN을 재설정해 주세요."),
    ACCOUNT_NOT_FOUND(HttpStatus.NOT_FOUND, "계정을 찾을 수 없습니다."),
    OUTSTANDING_RENTALS(HttpStatus.CONFLICT, "반납하지 않은 물품이 있어 탈퇴할 수 없습니다."),
    ACCOUNT_CHANGED(HttpStatus.CONFLICT, "로그인 계정이 변경되었습니다. 계정을 다시 확인해 주세요."),
    BROWSER_REGISTRATION_INVALID(HttpStatus.UNAUTHORIZED, "브라우저 등록이 유효하지 않습니다."),
    SESSION_REQUIRED(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다."),
    SESSION_EXPIRED(HttpStatus.UNAUTHORIZED, "로그인이 만료되었습니다."),
    SESSION_REPLACED(HttpStatus.UNAUTHORIZED, "다른 브라우저에서 로그인하여 종료되었습니다."),
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
