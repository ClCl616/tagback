package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.service.AdminSessionService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController @AdminOnly
@RequestMapping("/api/v1/admin")
public class AdministratorController {
    private final AdminSessionService service;
    private final AuthOriginGuard origins;
    public AdministratorController(AdminSessionService service,AuthOriginGuard origins) {this.service=service;this.origins=origins;}
    public record Account(String adminNumber,String name,Boolean active) {}
    public record PasswordChange(String currentPassword,String newPassword) {
        @Override public String toString(){return "PasswordChange[redacted]";}
    }
    @GetMapping("/accounts") public Object list(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin){return service.accounts(admin);}
    @PostMapping("/accounts") public Object create(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin,@RequestBody Account body,HttpServletRequest request){
        origins.check(request);return Map.of("temporaryPassword",service.create(admin,body.adminNumber(),body.name()));
    }
    @PatchMapping("/accounts/{number}") public Object update(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin,@PathVariable String number,@RequestBody Account body,HttpServletRequest request){
        origins.check(request);if(body.active()==null)throw new com.tagback.exception.AuthException(com.tagback.exception.AuthErrorCode.INVALID_INPUT);service.update(admin,number,body.name(),body.active());return Map.of("saved",true);
    }
    @GetMapping("/access-log") public Object log(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin){return service.accessLog(admin);}
    @PostMapping("/auth/password") public Object password(@RequestAttribute(AdminPrincipal.ATTRIBUTE) AdminPrincipal admin,@RequestBody PasswordChange body,HttpServletRequest request){
        origins.check(request);service.changePassword(admin,body.currentPassword(),body.newPassword());return Map.of("saved",true);
    }
}
