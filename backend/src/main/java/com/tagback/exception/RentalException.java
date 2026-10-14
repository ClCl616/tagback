package com.tagback.exception;

import java.time.Instant;

/** Rental authentication and checkout failures with safe public messages. */
public class RentalException extends RuntimeException {
    private final String code;
    private final int status;
    private final Instant retryAt;

    private RentalException(String code, String message, int status) {
        this(code, message, status, null);
    }

    private RentalException(String code, String message, int status, Instant retryAt) {
        super(message);
        this.code = code;
        this.status = status;
        this.retryAt = retryAt;
    }

    public static RentalException itemNotAvailable() {
        return new RentalException("ITEM_NOT_AVAILABLE", "현재 반출할 수 없는 물품입니다.", 409);
    }

    public static RentalException itemTypeMismatch() {
        return new RentalException("ITEM_TYPE_MISMATCH", "선택한 종류와 다른 물품입니다.", 409);
    }

    public String code() { return code; }
    public int status() { return status; }
    public Instant retryAt() { return retryAt; }

    public static RentalException activeRental() {
        return new RentalException("RENTAL_ALREADY_ACTIVE", "이미 진행 중인 대여가 있는 물품입니다.", 409);
    }
    public static RentalException grantRequired() {
        return new RentalException("RENTAL_GRANT_REQUIRED", "반출 인증이 필요합니다.", 401);
    }
    public static RentalException grantInvalid() {
        return new RentalException("RENTAL_GRANT_INVALID", "유효하지 않은 반출 인증입니다.", 401);
    }
    public static RentalException grantExpired() {
        return new RentalException("RENTAL_GRANT_EXPIRED", "반출 인증이 만료되었습니다.", 410);
    }
    public static RentalException codeInvalid() {
        return new RentalException("RENTAL_CODE_INVALID", "사용할 수 없는 대여 코드입니다.", 401);
    }
    public static RentalException codeConsumed() {
        return new RentalException("RENTAL_CODE_CONSUMED", "이미 사용한 대여 코드입니다.", 409);
    }
    public static RentalException verificationLimited(Instant retryAt) {
        return new RentalException("RENTAL_VERIFICATION_LIMITED", "잠시 후 코드를 다시 확인해 주세요.", 429, retryAt);
    }
    public static RentalException issuanceLimited() {
        return new RentalException("RENTAL_CODE_ISSUANCE_LIMITED", "대여 코드 발급 한도를 초과했습니다.", 429);
    }
    public static RentalException codeUnavailable() {
        return new RentalException("RENTAL_CODE_UNAVAILABLE", "대여 코드를 발급할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
}
