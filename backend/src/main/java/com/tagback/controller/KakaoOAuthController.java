package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.service.*;
import com.tagback.exception.AuthException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth/kakao")
public class KakaoOAuthController {
    public static final String FLOW="__Host-tagback-oauth";
    private final KakaoOAuthService oauth;
    private final SessionService sessions;
    private final AuthCookies cookies;
    private final AuthOriginGuard origins;
    public KakaoOAuthController(KakaoOAuthService oauth,SessionService sessions,AuthCookies cookies,AuthOriginGuard origins) {
        this.oauth=oauth;this.sessions=sessions;this.cookies=cookies;this.origins=origins;
    }
    public record StartRequest(String next, boolean switchAccount) {}
    public record Profile(@jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=40) String name,
                          @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max=40) String occupation) {}
    @PostMapping("/start") @PublicApi
    public ResponseEntity<?> start(@RequestBody StartRequest input,HttpServletRequest request) {
        origins.check(request);
        var started=oauth.start(cookie(request,FLOW),input.next(),input.switchAccount(),request.getRemoteAddr());
        sessions.logout(cookie(request,AuthCookies.SESSION_COOKIE));
        return response().header(HttpHeaders.SET_COOKIE,cookies.clearAll())
                .header(HttpHeaders.SET_COOKIE,flowCookie(started.browser(),600)).body(Map.of("url",started.url()));
    }
    @GetMapping("/callback") @PublicApi
    public ResponseEntity<Void> callback(@RequestParam(required=false) String state,@RequestParam(required=false) String code,
                                         @RequestParam(required=false) String error,HttpServletRequest request) {
        String browser=cookie(request,FLOW);
        try {
            var result=oauth.callback(state,browser,code,error);
            if(result.needsSignup()) return redirect("/mobile/signup").build();
            var issued=oauth.finish(browser,null,null);
            return redirect(issued.next()).header(HttpHeaders.SET_COOKIE,cookies.session(issued.token(),issued.expires())).build();
        } catch(AuthException e) {
            // Do not reflect provider errors, codes, state, or arbitrary return URLs in the browser.
            return redirect("/mobile/login?oauth="+("access_denied".equals(error)?"cancelled":"failed")).build();
        }
    }
    @GetMapping("/pending") @PublicApi
    public ResponseEntity<?> pending(HttpServletRequest request) {return response().body(oauth.pending(cookie(request,FLOW)));}
    @PostMapping("/complete") @PublicApi
    public ResponseEntity<?> complete(@RequestBody Profile input,HttpServletRequest request) {
        origins.check(request);
        var issued=oauth.finish(cookie(request,FLOW),input.name(),input.occupation());
        return response().header(HttpHeaders.SET_COOKIE,cookies.session(issued.token(),issued.expires()))
                .body(Map.of("next",issued.next(),"userId",issued.userId()));
    }
    public static String cookie(HttpServletRequest request,String name) {
        String value=null;
        if(request.getCookies()!=null) for(var cookie:request.getCookies()) if(name.equals(cookie.getName())) {
            if(value!=null) throw new com.tagback.exception.AuthException(com.tagback.exception.AuthErrorCode.OAUTH_INVALID);
            value=cookie.getValue();
        }
        return value;
    }
    public static String flowCookie(String value,long seconds) {
        return ResponseCookie.from(FLOW,value).path("/").httpOnly(true).secure(true).sameSite("Lax").maxAge(Duration.ofSeconds(seconds)).build().toString();
    }
    private ResponseEntity.BodyBuilder response() {return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer");}
    private ResponseEntity.BodyBuilder redirect(String path) {return ResponseEntity.status(303).header(HttpHeaders.LOCATION,path).cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer");}
}
