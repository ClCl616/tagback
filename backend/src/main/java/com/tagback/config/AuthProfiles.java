package com.tagback.config;

/** Live authentication is explicit; the ordinary production profile alone enables no mock flow. */
public final class AuthProfiles {
    private AuthProfiles() {}
    public static final String CORE = "(kakao-auth & !prod & !production) | (kakao-live & (prod | production))";
    public static final String KAKAO = "(kakao-auth & !prod & !production) | (kakao-live & (prod | production))";
    public static final String COMMON_SECRETS = KAKAO;
    public static final String LIVE = "kakao-live & (prod | production)";
}
