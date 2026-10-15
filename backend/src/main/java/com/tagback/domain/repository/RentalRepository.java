package com.tagback.domain.repository;

import com.tagback.domain.entity.Rental;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RentalRepository extends JpaRepository<Rental, Long> {
    // OVERDUE is still active. Checkout must lock the item before checking and saving.
    boolean existsByItem_IdAndReturnedAtIsNull(Long itemId);

    Optional<Rental> findByItem_IdAndReturnedAtIsNull(Long itemId);

    @EntityGraph(attributePaths = {"item", "item.itemType"})
    Page<Rental> findByUser_IdAndReturnedAtIsNull(Long userId, Pageable pageable);

    @EntityGraph(attributePaths = {"item", "item.itemType"})
    Page<Rental> findByUser_IdAndReturnedAtIsNotNull(Long userId, Pageable pageable);
}
