package com.tagback.domain.repository;

import com.tagback.domain.entity.*;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;


public interface SmsVerificationRepository extends JpaRepository<SmsVerification, UUID> {
    @Query("select s.phoneNumber from SmsVerification s where s.id = :id")
    Optional<String> findPhoneNumberById(@Param("id") UUID id);

    @Query("select min(s.sentAt) from SmsVerification s where s.phoneNumber = :phone and s.deliveryStatus = com.tagback.domain.entity.SmsDeliveryStatus.SENT and s.sentAt > :since")
    Optional<Instant> findOldestSentSince(@Param("phone") String phone, @Param("since") Instant since);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from SmsVerification s where s.id = :id")
    Optional<SmsVerification> findByIdForUpdate(@Param("id") UUID id);

    @Query("select count(s) from SmsVerification s where s.phoneNumber = :phone and s.deliveryStatus = com.tagback.domain.entity.SmsDeliveryStatus.SENT and s.sentAt > :since")
    long countSentSince(@Param("phone") String phone, @Param("since") Instant since);

    // Pending reservations also occupy capacity until the provider outcome is resolved.
    long countByPhoneNumberAndDeliveryStatus(String phoneNumber, SmsDeliveryStatus deliveryStatus);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update SmsVerification s set s.invalidatedAt = :now where s.phoneNumber = :phone and s.verifiedAt is null and s.invalidatedAt is null")
    int invalidateUnfinished(@Param("phone") String phone, @Param("now") Instant now);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update SmsVerification s set s.deliveryStatus = :status, s.sentAt = :sentAt where s.id = :id and s.deliveryStatus = com.tagback.domain.entity.SmsDeliveryStatus.PENDING")
    int completeDelivery(@Param("id") UUID id, @Param("status") SmsDeliveryStatus status, @Param("sentAt") Instant sentAt);

    @Modifying
    @Transactional(propagation = Propagation.MANDATORY)
    @Query("update SmsVerification s set s.verifiedAt = :now where s.id = :id and s.verifiedAt is null and s.invalidatedAt is null and s.expiresAt > :now and s.failedCount < 5 and s.deliveryStatus = com.tagback.domain.entity.SmsDeliveryStatus.SENT")
    int markVerified(@Param("id") UUID id, @Param("now") Instant now);
}
