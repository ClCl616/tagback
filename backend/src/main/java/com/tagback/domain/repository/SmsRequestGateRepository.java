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


public interface SmsRequestGateRepository extends JpaRepository<SmsRequestGate, String> {
    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query(value = "insert into sms_request_gates(phone_number) values (:phone) on conflict do nothing", nativeQuery = true)
    int ensureExists(@Param("phone") String phone);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from SmsRequestGate g where g.phoneNumber = :phone")
    Optional<SmsRequestGate> findForUpdate(@Param("phone") String phone);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update SmsRequestGate g set g.resendAvailableAt = :until where g.phoneNumber = :phone")
    int updateResendAvailableAt(@Param("phone") String phone, @Param("until") Instant until);
}

