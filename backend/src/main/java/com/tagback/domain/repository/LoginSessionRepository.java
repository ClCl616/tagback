package com.tagback.domain.repository;

import com.tagback.domain.entity.*;
import com.tagback.dto.auth.SmsPurpose;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;


public interface LoginSessionRepository extends JpaRepository<LoginSession, UUID> {
    @Query("select s.user.id from LoginSession s where s.sessionTokenHash = :hash")
    Optional<Long> findUserIdByTokenHash(@Param("hash") String hash);

    Optional<LoginSession> findBySessionTokenHash(String sessionTokenHash);

    @Query("select s from LoginSession s where s.sessionTokenHash = :hash and s.revokedAt is null and s.idleExpiresAt > :now and s.absoluteExpiresAt > :now and s.browserRegistration.revokedAt is null and s.browserRegistration.expiresAt > :now")
    Optional<LoginSession> findValidByTokenHash(@Param("hash") String hash, @Param("now") Instant now);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update LoginSession s set s.revokedAt = :now, s.revokedReason = :reason where s.user.id = :userId and s.revokedAt is null")
    int revokeAllForUser(@Param("userId") Long userId, @Param("now") Instant now, @Param("reason") SessionRevokedReason reason);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update LoginSession s set s.revokedAt = :now, s.revokedReason = :reason where s.browserRegistration.id = :registrationId and s.revokedAt is null")
    int revokeForRegistration(@Param("registrationId") UUID registrationId, @Param("now") Instant now,
                              @Param("reason") SessionRevokedReason reason);
}

