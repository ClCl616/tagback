package com.tagback.domain.repository;

import com.tagback.domain.entity.NfcTag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface NfcTagRepository extends JpaRepository<NfcTag, Long> {

    Optional<NfcTag> findByUid(String uid);

    @Query("select t from NfcTag t where t.item.id = :itemId and t.deactivatedAt is null")
    Optional<NfcTag> findByItem_Id(@Param("itemId") Long itemId);

    boolean existsByUid(String uid);

    @Query("select (count(t) > 0) from NfcTag t where t.item.id = :itemId and t.deactivatedAt is null")
    boolean existsByItem_Id(@Param("itemId") Long itemId);
}
