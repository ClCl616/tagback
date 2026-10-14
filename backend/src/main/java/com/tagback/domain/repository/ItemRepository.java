package com.tagback.domain.repository;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.query.Param;

public interface ItemRepository extends JpaRepository<Item, Long> {
    // Lock only the item row, avoiding a joined FOR UPDATE on nullable associations.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from Item i where i.id = :id")
    Optional<Item> findForUpdate(@Param("id") Long id);

    @Query(value = "select exists(select 1 from rentals where item_id = :id) "
            + "or exists(select 1 from inspections where item_id = :id)", nativeQuery = true)
    boolean hasUsageHistory(@Param("id") Long id);

    @Query(value = "select exists(select 1 from rentals where item_id = :id and returned_at is null)",
            nativeQuery = true)
    boolean hasActiveRental(@Param("id") Long id);

    @Query(value = "select exists(select 1 from rentals where item_id = :id and returned_at is null)",
            nativeQuery = true)
    boolean hasUnreturnedRental(@Param("id") Long id);

    @Query(value = "select exists(select 1 from nfc_tags where item_id = :id) "
            + "or exists(select 1 from rentals where item_id = :id) "
            + "or exists(select 1 from inspections where item_id = :id) "
            + "or exists(select 1 from item_status_history where item_id = :id)", nativeQuery = true)
    boolean hasDeletionReferences(@Param("id") Long id);

    @Override
    @EntityGraph(attributePaths = "itemType")
    Optional<Item> findById(Long id);

    @EntityGraph(attributePaths = "itemType")
    @Query("select i from Item i where (:itemTypeId is null or i.itemType.id = :itemTypeId) "
            + "and (:status is null or i.status = :status)")
    Page<Item> findFiltered(@Param("itemTypeId") Long itemTypeId,
                            @Param("status") ItemStatus status, Pageable pageable);
}
