package com.tagback;
import com.tagback.service.*;
import com.tagback.config.KakaoProperties;
import com.tagback.exception.AuthException;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class KakaoOAuthTest {
 @Test void returnPathsRejectExternalEncodedAndAuthDestinations() {
  for(String path:new String[]{null,"//evil.example","https://evil.example","/mobile/login","/mobile/%2f%2fevil","/mobile/../admin","/mobile\r\nLocation:x"})
   assertEquals("/mobile",KakaoOAuthService.safeNext(path));
  assertEquals("/mobile/code",KakaoOAuthService.safeNext("/mobile/code"));
  assertEquals("/mobile/items?search=test",KakaoOAuthService.safeNext("/mobile/items?search=test"));
 }
 @Test void providerIdentityMustBePositiveIntegerWithConsentedNickname() {
  var json=new ObjectMapper();
  for(String value:new String[]{"{}","{\"id\":\"12\"}","{\"id\":-1}","{\"id\":12,\"kakao_account\":{\"profile_nickname_needs_agreement\":true,\"profile\":{\"nickname\":\"name\"}}}"})
   assertThrows(IllegalArgumentException.class,()->KakaoClient.parseIdentity(json.readTree(value)));
  assertEquals(12,KakaoClient.parseIdentity(json.readTree("{\"id\":12,\"kakao_account\":{\"profile\":{\"nickname\":\"별명\"}}}")).id());
 }
 @Test void configurationFailsClosedAndUsesFixedProviderAndCallback() {
  assertThrows(AuthException.class,()->new KakaoProperties("","","").requireConfigured());
  assertThrows(AuthException.class,()->new KakaoProperties("id","secret","http://evil/callback").requireConfigured());
  var client=new KakaoClient(new KakaoProperties("id","secret","https://localhost/api/v1/auth/kakao/callback"),new ObjectMapper());
  var url=client.authorize("random",true);
  assertTrue(url.startsWith("https://kauth.kakao.com/oauth/authorize?"));
  assertTrue(url.contains("scope=profile_nickname"));assertTrue(url.contains("prompt=login"));
  assertFalse(url.contains("secret"));
 }
}
