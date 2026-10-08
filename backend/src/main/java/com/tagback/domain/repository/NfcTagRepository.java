package com.tagback.domain.repository;

import com.tagback.domain.entity.NfcTag;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface NfcTagRepository extends JpaRepository<NfcTag, Long> {

    Optional<NfcTag> findByUid(String uid);

    boolean existsByItem_Id(Long itemId);
}
