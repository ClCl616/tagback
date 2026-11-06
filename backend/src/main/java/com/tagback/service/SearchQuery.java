package com.tagback.service;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import jakarta.servlet.http.HttpServletRequest;

public final class SearchQuery {
    private SearchQuery() {}
    public static String keyword(String value) {
        if (value == null) return null;
        value = value.strip();
        if (value.codePointCount(0, value.length()) > 100) throw invalid();
        return value.isBlank() ? null : value;
    }
    public static String pattern(String value) {
        return "%" + value.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
    }
    public static void page(int page, int size) {
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE) throw invalid();
    }
    public static void rejectRepeated(HttpServletRequest request, String... names) {
        for (String name : names) {
            String[] values = request.getParameterValues(name);
            if (values != null && (values.length != 1 || (!name.equals("keyword") && values[0].isEmpty()))) throw invalid();
        }
    }
    public static AuthException invalid() { return new AuthException(AuthErrorCode.INVALID_INPUT); }
}
