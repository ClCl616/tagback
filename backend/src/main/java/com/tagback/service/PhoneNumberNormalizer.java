package com.tagback.service;

import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import org.springframework.stereotype.Component;

/** Initial scope: Korean 010 mobile numbers only. */
@Component
public class PhoneNumberNormalizer {
    public String normalize(String input) {
        if (input == null) throw new AuthException(AuthErrorCode.INVALID_INPUT);
        String number = input.replaceAll("[\\s-]", "");
        if (number.matches("010[0-9]{8}")) return "+82" + number.substring(1);
        if (number.matches("\\+8210[0-9]{8}")) return number;
        throw new AuthException(AuthErrorCode.INVALID_INPUT);
    }
}
