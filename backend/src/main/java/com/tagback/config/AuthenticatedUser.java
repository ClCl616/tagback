package com.tagback.config;

import com.tagback.domain.entity.UserRole;
import java.security.Principal;

/** Server-resolved identity; never contains a session token or a managed JPA entity. */
public record AuthenticatedUser(Long userId, UserRole role) implements Principal {
    public static final String ATTRIBUTE = "authenticatedUser";

    @Override
    public String getName() { return userId.toString(); }
}
