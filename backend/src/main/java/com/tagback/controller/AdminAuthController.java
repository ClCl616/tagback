package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.service.AdminSessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/admin/auth")
public class AdminAuthController {
    private final AdminSessionService sessions;
    private final AuthOriginGuard origins;
    public AdminAuthController(AdminSessionService sessions, AuthOriginGuard origins) { this.sessions=sessions; this.origins=origins; }
    public record Password(@NotBlank @Size(max=128) String password) {
        @Override public String toString() { return "AdminPassword[redacted]"; }
    }
    @PostMapping("/login") @PublicApi
    public ResponseEntity<AdminPrincipal> login(@Valid @RequestBody Password body, HttpServletRequest request) {
        origins.check(request);
        var login = sessions.login(body.password(), "WEB");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("Set-Cookie", cookie(login.token(),1800)).body(login.principal());
    }
    @GetMapping("/session") @AdminOnly
    public AdminPrincipal session(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal principal) { return principal; }
    @PostMapping("/logout") @AdminOnly
    public ResponseEntity<Void> logout(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal principal, HttpServletRequest request) {
        origins.check(request); sessions.logout(principal);
        return ResponseEntity.noContent().header("Set-Cookie",cookie("",0)).build();
    }
    private String cookie(String token,long seconds) {
        return ResponseCookie.from(AdminCredentials.COOKIE,token).path("/").secure(true).httpOnly(true).sameSite("Strict").maxAge(seconds).build().toString();
    }
}
