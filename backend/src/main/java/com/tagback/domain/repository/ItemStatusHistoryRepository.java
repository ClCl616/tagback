package com.tagback.domain.repository;

import com.tagback.domain.entity.ItemStatusHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ItemStatusHistoryRepository extends JpaRepository<ItemStatusHistory, Long> {
    List<ItemStatusHistory> findByItemIdOrderByIdAsc(Long itemId);
}
