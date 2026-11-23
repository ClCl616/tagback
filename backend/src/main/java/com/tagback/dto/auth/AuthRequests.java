package com.tagback.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/** Controllers must use @Valid. */
public final class AuthRequests {
    private AuthRequests() {}

    public record KakaoSignup(@NotNull UUID challengeId,
            @NotNull @Pattern(regexp = "[0-9]{6}") String pin,
            @NotNull @Valid Profile profile) {
        @Override public String toString() { return "KakaoSignup[redacted]"; }
    }
    public record KakaoNewBrowserLogin(@NotNull UUID challengeId,
            @NotNull @Pattern(regexp = "[0-9]{6}") String pin) {
        @Override public String toString() { return "KakaoNewBrowserLogin[redacted]"; }
    }
    public record KakaoPinReset(@NotNull UUID challengeId,
            @NotNull @Pattern(regexp = "[0-9]{6}") String pin) {
        @Override public String toString() { return "KakaoPinReset[redacted]"; }
    }
    public record Profile(@NotBlank @Size(max = 40) String name,
                          @NotBlank @Size(max = 40) String occupation) {}
    public record RegisteredLogin(@NotNull @Pattern(regexp = "[0-9]{6}") String pin) {
        @Override public String toString() { return "RegisteredLogin[redacted]"; }
    }
}
