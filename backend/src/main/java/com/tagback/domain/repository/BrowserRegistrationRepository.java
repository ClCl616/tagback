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


public interface BrowserRegistrationRepository extends JpaRepository<BrowserRegistration, UUID> {
    Optional<BrowserRegistration> findByRegistrationTokenHash(String registrationTokenHash);

    @Query("select b.user.id from BrowserRegistration b where b.registrationTokenHash = :hash")
    Optional<Long> findUserIdByTokenHash(@Param("hash") String hash);

    boolean existsByUserIdAndRevokedAtIsNull(Long userId);

    @Query("select b from BrowserRegistration b where b.registrationTokenHash = :hash and b.revokedAt is null and b.expiresAt > :now")
    Optional<BrowserRegistration> findValidByTokenHash(@Param("hash") String hash, @Param("now") Instant now);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update BrowserRegistration b set b.revokedAt = :now where b.user.id = :userId and b.revokedAt is null")
    int revokeAllForUser(@Param("userId") Long userId, @Param("now") Instant now);
}

