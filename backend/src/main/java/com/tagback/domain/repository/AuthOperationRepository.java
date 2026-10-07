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


public interface AuthOperationRepository extends JpaRepository<AuthOperation, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from AuthOperation o where o.callerScopeHash = :scope and o.operationType = :type and o.idempotencyKey = :key")
    Optional<AuthOperation> findForUpdate(@Param("scope") String scope, @Param("type") String type, @Param("key") String key);

    Optional<AuthOperation> findByIdAndCallerScopeHash(UUID id, String callerScopeHash);
}

