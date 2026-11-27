package com.tagback;

import com.tagback.config.*;
import com.tagback.controller.KakaoOAuthController;
import com.tagback.service.*;
import com.tagback.exception.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.context.WebApplicationContext;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup;

@EnabledIfEnvironmentVariable(named="TAGBACK_AUTH_SCHEMA_TEST",matches="true")
@SpringBootTest(properties={"spring.datasource.url=jdbc:postgresql://127.0.0.1:55439/tagback_auth_test",
 "spring.datasource.username=postgres","spring.datasource.password=", "tagback.auth.hash-key=isolated-oauth-test-only-key-32-characters"})
class KakaoOAuthIntegrationTest {
 @Autowired KakaoOAuthService oauth;
 @Autowired SessionService sessions;
 @Autowired RentalCodeService codes;
 @Autowired JdbcTemplate db;
 @Autowired WebApplicationContext context;
 @Autowired AuthSecrets secrets;
 @MockitoBean KakaoClient kakao;
 MockMvc mvc;
 static AtomicLong ids=new AtomicLong(9000000);
 long id;
 record Flow(String state,String browser) {}
 @BeforeEach void setup() {
  id=ids.incrementAndGet(); mvc=webAppContextSetup(context).build();
  when(kakao.authorize(anyString(),anyBoolean())).thenAnswer(i->i.getArgument(0));
  when(kakao.exchange(anyString())).thenReturn(new KakaoClient.Identity(id,"카카오 별명"));
 }
 Flow flow() {var start=oauth.start(null,"/mobile/code",false);return new Flow(start.url(),start.browser());}
 void verified(Flow f) {oauth.callback(f.state(),f.browser(),"provider-code",null);}
 Cookie flowCookie(Flow f) {return new Cookie(KakaoOAuthController.FLOW,f.browser());}
 Cookie sessionCookie(String token) {return new Cookie(AuthCookies.SESSION_COOKIE,token);}
 @Test void firstSignupIsEditableAndRentalCodeRemainsSixDigitsWithoutPhone() {
  var f=flow(); verified(f);
  assertTrue(oauth.pending(f.browser()).needsSignup());
  assertEquals("카카오 별명",oauth.pending(f.browser()).nickname());
  var issued=oauth.finish(f.browser(),"내 별명","학생");
  var status=sessions.current(issued.token());
  assertEquals("내 별명",status.user().name());
  assertEquals("",status.user().maskedPhoneNumber());
  var code=codes.issue(Long.parseLong(status.user().userId()));
  assertTrue(code.code().matches("[0-9]{6}"));
  assertEquals("카카오 이용자",codes.verify(code.code(),"127.0.0.9").maskedPhoneNumber());
 }
 @Test void returnLoginUsesKakaoIdNotNicknameAndRotatesSessions() {
  var f=flow(); verified(f); var first=oauth.finish(f.browser(),"같은 이름","학생");
  long uid=Long.parseLong(sessions.current(first.token()).user().userId());
  var again=flow(); verified(again);assertFalse(oauth.pending(again.browser()).needsSignup());
  var second=oauth.finish(again.browser(),null,null);
  assertEquals(uid,Long.parseLong(sessions.current(second.token()).user().userId()));
  assertThrows(AuthException.class,()->sessions.current(first.token()));
  when(kakao.exchange(anyString())).thenReturn(new KakaoClient.Identity(ids.incrementAndGet(),"같은 이름"));
  var other=flow();verified(other);var third=oauth.finish(other.browser(),"같은 이름","기타");
  assertNotEquals(uid,Long.parseLong(sessions.current(third.token()).user().userId()));
 }
 @Test void rejectsMissingWrongExpiredAndReplayedStateBeforeProviderCall() {
  var f=flow();
  assertThrows(AuthException.class,()->oauth.callback(f.state(),secrets.generateToken(),"x",null));
  assertThrows(AuthException.class,()->oauth.callback(null,f.browser(),"x",null));
  verify(kakao,never()).exchange(anyString());
  verified(f); assertThrows(AuthException.class,()->oauth.callback(f.state(),f.browser(),"x",null));
  verify(kakao,times(1)).exchange(anyString());
  var expired=flow(); db.update("update oauth_attempts set expires_at=now()-interval '1 second' where browser_hash=?",secrets.tokenHash(expired.browser()));
  assertThrows(AuthException.class,()->verified(expired));
 }
 @Test void cancellationAndProviderFailureNeverCreateSessionsOrReplayCode() {
  var f=flow();assertThrows(AuthException.class,()->oauth.callback(f.state(),f.browser(),null,"access_denied"));
  verify(kakao,never()).exchange(anyString());
  assertThrows(AuthException.class,()->oauth.pending(f.browser()));
  var failed=flow();when(kakao.exchange(anyString())).thenThrow(new AuthException(AuthErrorCode.OAUTH_FAILED));
  assertThrows(AuthException.class,()->verified(failed));
  assertThrows(AuthException.class,()->verified(failed));
  assertEquals(0,db.queryForObject("select count(*) from users where kakao_user_id=?",Integer.class,id));
 }
 @Test void lostSignupResponseCanRetryWithoutChangingProfileOrDuplicatingAccount() {
  var f=flow();verified(f);var lost=oauth.finish(f.browser(),"처음","학생");
  var retry=oauth.finish(f.browser(),"나중","기타");
  assertEquals("처음",sessions.current(retry.token()).user().name());
  assertThrows(AuthException.class,()->sessions.current(lost.token()));
  assertEquals(1,db.queryForObject("select count(*) from users where kakao_user_id=?",Integer.class,id));
 }
 @Test void parallelBrowsersCreateExactlyOneAccount() throws Exception {
  var a=flow();var b=flow();verified(a);verified(b);
  try(var pool=Executors.newFixedThreadPool(2)) {
   var gate=new CountDownLatch(1);
   var one=pool.submit(()->{gate.await();return oauth.finish(a.browser(),"A","학생");});
   var two=pool.submit(()->{gate.await();return oauth.finish(b.browser(),"B","학생");});
   gate.countDown();assertNotNull(one.get(15,TimeUnit.SECONDS));assertNotNull(two.get(15,TimeUnit.SECONDS));
  }
  assertEquals(1,db.queryForObject("select count(*) from users where kakao_user_id=?",Integer.class,id));
 }
 @Test void callbackRedirectCookiesAndLogoutAreBoundToBrowser() throws Exception {
  var f=flow();
  mvc.perform(get("/api/v1/auth/kakao/callback").param("state",f.state()).param("code","provider-code").cookie(flowCookie(f)))
   .andExpect(status().isSeeOther()).andExpect(header().string("Location","/mobile/signup"))
   .andExpect(header().string("Referrer-Policy","no-referrer"));
  var response=mvc.perform(post("/api/v1/auth/kakao/complete").cookie(flowCookie(f)).contentType("application/json")
    .content("{\"name\":\"별명\",\"occupation\":\"학생\"}"))
   .andExpect(status().isOk()).andReturn().getResponse();
  String cookie=response.getHeader("Set-Cookie");
  assertTrue(cookie.contains("Secure"));assertTrue(cookie.contains("HttpOnly"));assertTrue(cookie.contains("SameSite=Lax"));
  var token=cookie.substring(cookie.indexOf('=')+1,cookie.indexOf(';'));
  mvc.perform(post("/api/v1/auth/logout").cookie(flowCookie(f),sessionCookie(token))).andExpect(status().isNoContent());
  assertThrows(AuthException.class,()->oauth.pending(f.browser()));
  assertThrows(AuthException.class,()->sessions.current(token));
 }
 @Test void csrfAndRemovedPinEndpointsFailClosed() throws Exception {
  var f=flow();verified(f);
  mvc.perform(post("/api/v1/auth/kakao/complete").cookie(flowCookie(f)).header("Origin","https://evil.example")
    .contentType("application/json").content("{\"name\":\"별명\",\"occupation\":\"학생\"}"))
   .andExpect(status().isForbidden());
  mvc.perform(post("/api/v1/auth/kakao/start").header("Origin","https://evil.example").contentType("application/json").content("{\"switchAccount\":false}"))
   .andExpect(status().isForbidden());
  for(String path:List.of("/login/phone","/login/registered","/pin/reset","/signup","/sms/requests"))
   mvc.perform(post("/api/v1/auth"+path).contentType("application/json").content("{}"))
    .andExpect(result->assertTrue(result.getResponse().getStatus()>=400));
 }
 @Test void invalidProfileAndExpiredSignupCannotCreateAccount() {
  var f=flow();verified(f);
  assertThrows(AuthException.class,()->oauth.finish(f.browser()," ","학생"));
  assertThrows(AuthException.class,()->oauth.finish(f.browser(),"이름","unsupported"));
  db.update("update oauth_attempts set expires_at=now()-interval '1 second' where browser_hash=?",secrets.tokenHash(f.browser()));
  assertThrows(AuthException.class,()->oauth.finish(f.browser(),"이름","학생"));
  assertEquals(0,db.queryForObject("select count(*) from users where kakao_user_id=?",Integer.class,id));
 }
 @Test void accountSwitchInvalidatesPreviousFlowAndServiceSession() throws Exception {
  var old=flow();verified(old);var issued=oauth.finish(old.browser(),"이전","학생");
  mvc.perform(post("/api/v1/auth/kakao/start").cookie(flowCookie(old),sessionCookie(issued.token()))
   .contentType("application/json").content("{\"next\":\"https://evil.example\",\"switchAccount\":true}"))
   .andExpect(status().isOk());
  verify(kakao).authorize(anyString(),eq(true));
  assertThrows(AuthException.class,()->sessions.current(issued.token()));
  assertThrows(AuthException.class,()->oauth.pending(old.browser()));
 }
}
