package com.tagback.service;

import com.tagback.config.KakaoProperties;
import com.tagback.exception.AuthException;
import java.net.http.*;
import java.io.IOException;
import java.util.concurrent.Flow;
import java.nio.ByteBuffer;
import java.io.ByteArrayOutputStream;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class KakaoClientHttpTest {
 private final KakaoProperties config=new KakaoProperties("app-key","test-secret","https://localhost/api/v1/auth/kakao/callback");
 @SuppressWarnings("unchecked") private HttpResponse<String> response(int status,String body) {
  var result=(HttpResponse<String>)mock(HttpResponse.class);when(result.statusCode()).thenReturn(status);when(result.body()).thenReturn(body);return result;
 }
 @Test void exchangesCodeOnlyOnServerAndUsesReturnedBearerForIdentity() throws Exception {
  var http=mock(HttpClient.class);
  var tokenResponse=response(200,"{\"access_token\":\"provider-token\",\"token_type\":\"bearer\",\"expires_in\":3600}");
  var userResponse=response(200,"{\"id\":12345,\"kakao_account\":{\"profile\":{\"nickname\":\"별명\"}}}");
  when(http.send(any(HttpRequest.class),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any()))
   .thenReturn(tokenResponse,userResponse);
  var identity=new KakaoClient(config,new ObjectMapper(),http).exchange("code&injection=x");
  assertEquals(12345,identity.id());
  var requests=ArgumentCaptor.forClass(HttpRequest.class);
  verify(http,times(2)).send(requests.capture(),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
  assertEquals("https://kauth.kakao.com/oauth/token",requests.getAllValues().get(0).uri().toString());
  assertEquals("https://kapi.kakao.com/v2/user/me",requests.getAllValues().get(1).uri().toString());
  assertEquals("Bearer provider-token",requests.getAllValues().get(1).headers().firstValue("Authorization").orElseThrow());
  var bytes=new ByteArrayOutputStream();
  requests.getAllValues().getFirst().bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
   public void onSubscribe(Flow.Subscription subscription){subscription.request(Long.MAX_VALUE);}
   public void onNext(ByteBuffer buffer){byte[] b=new byte[buffer.remaining()];buffer.get(b);bytes.writeBytes(b);}
   public void onError(Throwable t){throw new AssertionError(t);}
   public void onComplete(){}
  });
  String form=bytes.toString(java.nio.charset.StandardCharsets.UTF_8);
  assertTrue(form.contains("code=code%26injection%3Dx"));assertTrue(form.contains("client_secret=test-secret"));
 }
 @Test void rejectsProviderErrorRedirectMalformedTokenAndTransportFailureWithoutLeakingBody() throws Exception {
  for(var response:java.util.List.of(response(302,"sensitive-body"),response(400,"sensitive-body"),response(200,"not json"),response(200,"{\"access_token\":\"secret\",\"token_type\":\"other\"}"))) {
   var http=mock(HttpClient.class);when(http.send(any(HttpRequest.class),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any())).thenReturn(response);
   var error=assertThrows(AuthException.class,()->new KakaoClient(config,new ObjectMapper(),http).exchange("code"));
   assertFalse(error.toString().contains("secret"));assertFalse(error.toString().contains("sensitive-body"));
   verify(http,times(1)).send(any(HttpRequest.class),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
  }
  var http=mock(HttpClient.class);when(http.send(any(HttpRequest.class),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any())).thenThrow(new IOException("secret provider body"));
  assertThrows(AuthException.class,()->new KakaoClient(config,new ObjectMapper(),http).exchange("code"));
 }
}
