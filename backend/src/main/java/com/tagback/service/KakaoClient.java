package com.tagback.service;

import com.tagback.config.KakaoProperties;
import com.tagback.exception.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Fixed HTTPS provider endpoints; tokens never enter browser responses, storage or logs. */
@Component
public class KakaoClient {
    private final KakaoProperties config;
    private final ObjectMapper json;
    private final HttpClient http;
    @org.springframework.beans.factory.annotation.Autowired
    public KakaoClient(KakaoProperties config, ObjectMapper json) {
        this(config,json,HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER).build());
    }
    KakaoClient(KakaoProperties config,ObjectMapper json,HttpClient http) {
        this.config=config;this.json=json;this.http=http;
    }
    public record Identity(long id, String nickname) {}
    public String authorize(String state, boolean switchAccount) {
        config.requireConfigured();
        return "https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=" + enc(config.clientId)
                + "&redirect_uri=" + enc(config.redirectUri) + "&scope=profile_nickname&state=" + enc(state)
                + (switchAccount ? "&prompt=login" : "");
    }
    public Identity exchange(String code) {
        config.requireConfigured();
        if (code == null || code.isBlank() || code.length() > 2048) throw new AuthException(AuthErrorCode.OAUTH_INVALID);
        try {
            var request = HttpRequest.newBuilder(URI.create("https://kauth.kakao.com/oauth/token"))
                    .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString("grant_type=authorization_code&client_id=" + enc(config.clientId)
                            + "&client_secret=" + enc(config.clientSecret) + "&redirect_uri=" + enc(config.redirectUri)
                            + "&code=" + enc(code))).build();
            JsonNode tokens = send(request);
            String token = tokens.path("access_token").asText("");
            if (token.isBlank() || token.length() > 4096 || !"bearer".equalsIgnoreCase(tokens.path("token_type").asText())
                    || tokens.path("expires_in").asLong(0) <= 0) throw new IllegalArgumentException();
            var user = send(HttpRequest.newBuilder(URI.create("https://kapi.kakao.com/v2/user/me"))
                    .timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + token).GET().build());
            return parseIdentity(user);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw new AuthException(AuthErrorCode.OAUTH_FAILED);
        } catch (Exception e) { throw new AuthException(AuthErrorCode.OAUTH_FAILED); }
    }
    public static Identity parseIdentity(JsonNode user) {
        var id = user.path("id");
        if (!id.isIntegralNumber() || !id.canConvertToLong() || id.asLong() <= 0) throw new IllegalArgumentException();
        var account = user.path("kakao_account");
        String name = account.path("profile").path("nickname").asText("").strip();
        if (account.path("profile_nickname_needs_agreement").asBoolean(false) || name.isBlank())
            throw new IllegalArgumentException();
        return new Identity(id.asLong(), name.substring(0, name.offsetByCodePoints(0, Math.min(40,name.codePointCount(0,name.length())))));
    }
    private JsonNode send(HttpRequest request) throws Exception {
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200 || response.body().length() > 100_000) throw new IllegalArgumentException();
        return json.readTree(response.body());
    }
    private static String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
