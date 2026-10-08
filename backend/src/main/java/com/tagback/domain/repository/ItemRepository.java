package com.tagback.domain.repository;

import com.tagback.domain.entity.Item;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface ItemRepository extends JpaRepository<Item, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from Item i where i.id = :id")
    Optional<Item> findByIdForUpdate(@Param("id") Long id);

    @Query(value = "select exists(select 1 from rentals where item_id = :id and returned_at is null)",
            nativeQuery = true)
    boolean hasUnreturnedRental(@Param("id") Long id);
}
