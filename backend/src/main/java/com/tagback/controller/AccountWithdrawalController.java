package com.tagback.controller;

import com.tagback.config.AuthCookies;
import com.tagback.config.AuthOriginGuard;
import com.tagback.config.AuthenticatedUser;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.AccountWithdrawalService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile(com.tagback.config.AuthProfiles.KAKAO)
@RequestMapping("/api/v1/account")
public class AccountWithdrawalController {
    private final AccountWithdrawalService withdrawal;
    private final AuthOriginGuard origins;
    private final AuthCookies cookies;
    public AccountWithdrawalController(AccountWithdrawalService withdrawal, AuthOriginGuard origins, AuthCookies cookies) {
        this.withdrawal = withdrawal; this.origins = origins; this.cookies = cookies;
    }
    @DeleteMapping
    public ResponseEntity<Void> withdraw(@CookieValue(name = AuthCookies.SESSION_COOKIE, required = false) String session,
                                         @RequestHeader(name = "X-Expected-User-Id", required = false) String expectedUserId,
                                         @RequestAttribute(AuthenticatedUser.ATTRIBUTE) AuthenticatedUser user,
                                         HttpServletRequest request) {
        origins.check(request);
        if (expectedUserId == null || !user.userId().toString().equals(expectedUserId))
            throw new AuthException(AuthErrorCode.ACCOUNT_CHANGED);
        withdrawal.withdraw(session);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, cookies.clearAll()).build();
    }
}
