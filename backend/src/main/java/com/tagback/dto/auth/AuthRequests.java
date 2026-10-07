package com.tagback.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Controllers must use @Valid; phone numbers are normalized in the service. */
public final class AuthRequests {
    private AuthRequests() {}

    public record SmsRequest(
            @NotBlank @Size(max = 32) String phoneNumber,
            @NotNull SmsPurpose purpose) {
        @Override public String toString() { return "SmsRequest[redacted]"; }
    }
    public record SmsVerification(
            @NotBlank @Size(max = 128) String requestId,
            @NotNull @Pattern(regexp = "[0-9]{6}") String code) {
        @Override public String toString() { return "SmsVerification[redacted]"; }
    }
    public record Signup(
            @NotBlank @Size(max = 512) String verificationToken,
            @NotNull @Pattern(regexp = "[0-9]{6}") String pin,
            @NotNull @Valid Profile profile) {
        @Override public String toString() { return "Signup[redacted]"; }
    }
    public record Profile(@NotBlank @Size(max = 40) String name,
                          @NotBlank @Size(max = 40) String occupation) {}
    public record PhoneLogin(@NotBlank @Size(max = 32) String phoneNumber,
                             @NotNull @Pattern(regexp = "[0-9]{6}") String pin) {
        @Override public String toString() { return "PhoneLogin[redacted]"; }
    }
    public record PinReset(
            @NotBlank @Size(max = 512) String verificationToken,
            @NotNull @Pattern(regexp = "[0-9]{6}") String pin) {
        @Override public String toString() { return "PinReset[redacted]"; }
    }
    public record RegisteredLogin(@NotNull @Pattern(regexp = "[0-9]{6}") String pin) {
        @Override public String toString() { return "RegisteredLogin[redacted]"; }
    }
    public record NewBrowserLogin(
            @NotBlank @Size(max = 512) String verificationToken,
            @NotNull @Pattern(regexp = "[0-9]{6}") String pin) {
        @Override public String toString() { return "NewBrowserLogin[redacted]"; }
    }
}
