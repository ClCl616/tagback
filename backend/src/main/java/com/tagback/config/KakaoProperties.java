package com.tagback.config;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import com.tagback.exception.*;

@Component
public class KakaoProperties {
    public final String clientId;
    public final String clientSecret;
    public final String redirectUri;
    public KakaoProperties(@Value("${tagback.kakao.client-id:}") String id,
                           @Value("${tagback.kakao.client-secret:}") String secret,
                           @Value("${tagback.kakao.redirect-uri:}") String redirect) {
        clientId = id; clientSecret = secret; redirectUri = redirect;
    }
    public void requireConfigured() {
        try {
            URI uri = URI.create(redirectUri);
            if (clientId.isBlank() || clientSecret.isBlank() || !"https".equals(uri.getScheme())
                    || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || uri.getRawFragment() != null || !"/api/v1/auth/kakao/callback".equals(uri.getPath()))
                throw new IllegalArgumentException();
        } catch (IllegalArgumentException e) { throw new AuthException(AuthErrorCode.OAUTH_NOT_CONFIGURED); }
    }
}
