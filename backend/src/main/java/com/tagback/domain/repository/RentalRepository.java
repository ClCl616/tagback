package com.tagback.domain.repository;

import com.tagback.domain.entity.Rental;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RentalRepository extends JpaRepository<Rental, Long> {
    // OVERDUE is still active. Checkout must lock the item before checking and saving.
    boolean existsByItem_IdAndReturnedAtIsNull(Long itemId);

    Optional<Rental> findByItem_IdAndReturnedAtIsNull(Long itemId);
}
