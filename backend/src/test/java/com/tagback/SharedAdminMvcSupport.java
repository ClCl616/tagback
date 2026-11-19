package com.tagback;

import com.tagback.config.AdminPrincipal;
import com.tagback.exception.*;
import com.tagback.service.AdminSessionService;
import com.tagback.service.AdminAudit;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import java.time.Instant;
import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

abstract class SharedAdminMvcSupport {
    static final UUID ADMIN_ID = UUID.fromString("00000000-0000-4000-8000-000000000001");
    @MockitoBean AdminSessionService sharedAdmins;
    @MockitoBean AdminAudit adminAudit;
    @BeforeEach void sharedAdminSession() {
        when(sharedAdmins.authenticate(nullable(String.class),anyString())).thenAnswer(call -> {
            String token=call.getArgument(0);
            if (token == null || !token.startsWith("admin")) throw new AuthException(AuthErrorCode.SESSION_REQUIRED);
            return new AdminPrincipal(ADMIN_ID,call.getArgument(1),Instant.parse("2099-01-01T00:00:00Z"));
        });
    }
}
