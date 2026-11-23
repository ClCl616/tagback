package com.tagback.controller;

import com.tagback.config.PublicApi;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Connectivity probe only; it never authenticates a user or processes a code. */
@RestController
@Profile("kakao-skill-probe & !prod & !production")
public class KakaoSkillProbeController {
    private final String secret;

    public KakaoSkillProbeController(@Value("${TAGBACK_KAKAO_SKILL_SECRET:}") String secret) {
        this.secret = secret;
    }

    @PublicApi
    @PostMapping(path = "/api/v1/dev/kakao/skill-probe", consumes = "application/json")
    public ResponseEntity<?> probe(HttpServletRequest request, @RequestBody Map<String, Object> payload) {
        if (secret.isBlank() || secret.length() < 32) {
            return ResponseEntity.status(503).cacheControl(CacheControl.noStore()).build();
        }
        var headers = Collections.list(request.getHeaders("X-Tagback-Skill-Secret"));
        if (headers.size() != 1 || !MessageDigest.isEqual(secret.getBytes(StandardCharsets.UTF_8),
                headers.getFirst().getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(403).cacheControl(CacheControl.noStore()).build();
        }
        if (!(payload.get("userRequest") instanceof Map<?, ?>)) {
            return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).build();
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of(
                "version", "2.0", "template", Map.of("outputs", List.of(
                        Map.of("simpleText", Map.of("text", "스킬 서버 연결을 확인했습니다."))))));
    }
}
