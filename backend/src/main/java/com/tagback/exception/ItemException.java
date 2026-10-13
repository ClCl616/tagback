package com.tagback.exception;

/** Item API domain failure; messages are safe for client responses. */
public class ItemException extends RuntimeException {
    private final String code;
    private final int status;

    public ItemException() {
        this("ITEM_TYPE_NOT_FOUND", "물품 종류를 찾을 수 없습니다.");
    }

    private ItemException(String code, String message) {
        this(code, message, 404);
    }

    private ItemException(String code, String message, int status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public static ItemException itemNotFound() {
        return new ItemException("ITEM_NOT_FOUND", "물품을 찾을 수 없습니다.");
    }

    public String code() { return code; }
    public int status() { return status; }

    public static ItemException typeChangeConflict() {
        return new ItemException("ITEM_TYPE_CHANGE_CONFLICT", "대여·점검 기록이 있는 물품의 종류는 변경할 수 없습니다.", 409);
    }

    public static ItemException deleteConflict() {
        return new ItemException("ITEM_DELETE_CONFLICT", "태그·대여·점검 기록이 연결된 물품은 삭제할 수 없습니다.", 409);
    }

    public static ItemException statusChangeConflict() {
        return new ItemException("ITEM_STATUS_CHANGE_CONFLICT", "현재 대여·태그·물품 상태에서는 상태를 변경할 수 없습니다.", 409);
    }

}
