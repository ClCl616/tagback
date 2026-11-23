package com.tagback.controller;

import com.tagback.config.AuthOriginGuard;
import com.tagback.config.PublicApi;
import com.tagback.exception.AuthErrorCode;
import com.tagback.exception.AuthException;
import com.tagback.service.KakaoChallengeService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Kakao challenge and skill endpoints, enabled by explicit authentication profiles. */
@RestController
@Profile(com.tagback.config.AuthProfiles.KAKAO)
@RequestMapping("/api/v1/auth/kakao")
public class KakaoChallengeController {
    public static final String PROOF_COOKIE = "__Host-tagback-kakao-proof";
    private final KakaoChallengeService challenges;
    private final AuthOriginGuard origins;
    private final String secret;

    public KakaoChallengeController(KakaoChallengeService challenges, AuthOriginGuard origins,
            @Value("${tagback.kakao.skill-secret:}") String secret) {
        if (secret == null || secret.length() < 32) throw new IllegalStateException("Kakao skill secret must be configured");
        this.challenges = challenges; this.origins = origins; this.secret = secret;
    }

    @PublicApi @PostMapping("/challenges")
    public ResponseEntity<KakaoChallengeService.Issued> create(@Valid @RequestBody Create input,
            HttpServletRequest request) {
        origins.check(request);
        String proof = proof(request);
        if (!challenges.validProof(proof)) proof = challenges.newProof();
        var issued = challenges.issue(input.purpose(), proof, request.getRemoteAddr());
        String cookie = ResponseCookie.from(PROOF_COOKIE, proof).secure(true).httpOnly(true).sameSite("Lax")
                .path("/").maxAge(Duration.ofDays(1)).build().toString();
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE, cookie).body(issued);
    }

    @PublicApi @GetMapping("/challenges/{id}")
    public ResponseEntity<KakaoChallengeService.Status> status(@PathVariable UUID id,
            HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(challenges.status(id, proof(request)));
    }

    @PublicApi @DeleteMapping("/challenges/{id}")
    public ResponseEntity<Void> cancel(@PathVariable UUID id,
            HttpServletRequest request) {
        origins.check(request); challenges.cancel(id, proof(request));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    public static String proof(HttpServletRequest request) {
        String found = null;
        if (request.getCookies() != null) for (var cookie : request.getCookies()) {
            if (PROOF_COOKIE.equals(cookie.getName())) {
                if (found != null) throw new AuthException(AuthErrorCode.VERIFICATION_INVALID);
                found = cookie.getValue();
            }
        }
        return found;
    }

    @PublicApi @PostMapping(path = "/skill", consumes = "application/json")
    public ResponseEntity<?> skill(HttpServletRequest request, @RequestBody Map<String, Object> payload) {
        var headers = Collections.list(request.getHeaders("X-Tagback-Skill-Secret"));
        if (headers.size() != 1 || !MessageDigest.isEqual(secret.getBytes(StandardCharsets.UTF_8), headers.getFirst().getBytes(StandardCharsets.UTF_8)))
            return ResponseEntity.status(403).cacheControl(CacheControl.noStore()).build();
        boolean ok = challenges.verify(payload, request.getRemoteAddr());
        String text = ok ? "인증 요청을 확인했습니다. 원래 화면으로 돌아가 진행해 주세요." : "인증 요청을 확인할 수 없습니다. 코드를 확인하거나 새로 발급해 주세요.";
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("version", "2.0", "template", Map.of("outputs", List.of(Map.of("simpleText", Map.of("text", text))))));
    }

    public record Create(@NotBlank @Pattern(regexp = "SIGNUP|LOGIN|PIN_RESET") String purpose) {}
}
