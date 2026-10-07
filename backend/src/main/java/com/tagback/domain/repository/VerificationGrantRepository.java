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


public interface VerificationGrantRepository extends JpaRepository<VerificationGrant, UUID> {
    @Query("select g.phoneNumber from VerificationGrant g where g.tokenHash = :hash")
    Optional<String> findPhoneNumberByTokenHash(@Param("hash") String hash);

    Optional<VerificationGrant> findByTokenHash(String tokenHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from VerificationGrant g where g.tokenHash = :hash")
    Optional<VerificationGrant> findByTokenHashForUpdate(@Param("hash") String hash);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update VerificationGrant g set g.consumedAt = :now where g.id = :id and g.phoneNumber = :phone and g.purpose = :purpose and g.consumedAt is null and g.expiresAt > :now")
    int consumeIfAvailable(@Param("id") UUID id, @Param("phone") String phone,
                           @Param("purpose") SmsPurpose purpose, @Param("now") Instant now);
}

