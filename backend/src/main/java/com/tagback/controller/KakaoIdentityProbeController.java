package com.tagback.controller;

import com.tagback.config.PublicApi;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Temporary diagnostic: never logs or returns user identifiers or utterances. */
@RestController
@Profile("kakao-skill-probe & !prod & !production")
public class KakaoIdentityProbeController {
    private final String secret;
    private final byte[] comparisonKey = new byte[32];
    private byte[] firstId;

    public KakaoIdentityProbeController(@Value("${TAGBACK_KAKAO_SKILL_SECRET:}") String secret) {
        this.secret = secret;
        new SecureRandom().nextBytes(comparisonKey);
    }

    @PublicApi
    @PostMapping(path = "/api/v1/dev/kakao/identity-probe", consumes = "application/json")
    public ResponseEntity<?> probe(HttpServletRequest request, @RequestBody Map<String, Object> payload) {
        if (secret.isBlank() || secret.length() < 32) return ResponseEntity.status(503).cacheControl(CacheControl.noStore()).build();
        var headers = Collections.list(request.getHeaders("X-Tagback-Skill-Secret"));
        if (headers.size() != 1 || !MessageDigest.isEqual(secret.getBytes(StandardCharsets.UTF_8), headers.getFirst().getBytes(StandardCharsets.UTF_8)))
            return ResponseEntity.status(403).cacheControl(CacheControl.noStore()).build();
        if (!(payload.get("userRequest") instanceof Map<?, ?> userRequest)) return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).build();
        var user = userRequest.get("user") instanceof Map<?, ?> m ? m : Map.of();
        var properties = user.get("properties") instanceof Map<?, ?> m ? m : Map.of();
        String type = "botUserKey".equals(user.get("type")) ? "botUserKey" : "기타 또는 없음";
        String result = "없음";
        if (user.get("id") instanceof String id && !id.isBlank() && id.length() <= 256) result = compare(id);
        String message = "식별값 시험: type=" + type + ", user.id=" + result
                + ", botUserKey=" + present(properties, "botUserKey")
                + ", plusfriendUserKey=" + present(properties, "plusfriendUserKey")
                + ", appUserId=" + present(properties, "appUserId") + ". 실제 인증은 아닙니다.";
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("version", "2.0", "template", Map.of("outputs", List.of(Map.of("simpleText", Map.of("text", message))))));
    }

    private static String present(Map<?, ?> map, String key) {
        Object value = map.get(key);
        return value != null && !value.toString().isBlank() ? "있음" : "없음";
    }

    private synchronized String compare(String id) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(comparisonKey, "HmacSHA256"));
            byte[] digest = mac.doFinal(id.getBytes(StandardCharsets.UTF_8));
            if (firstId == null) { firstId = digest; return "첫 요청"; }
            return MessageDigest.isEqual(firstId, digest) ? "첫 요청과 일치" : "첫 요청과 다름";
        } catch (java.security.GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
}
