package com.tagback.domain.repository;

import com.tagback.domain.entity.ItemType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ItemTypeRepository extends JpaRepository<ItemType, Long> {
    interface CatalogRow {
        Long getId();
        String getName();
        Long getTotalCount();
        Long getAvailableCount();
    }

    @Query(value = "select t.id as id, t.name as name, count(i.id) as totalCount, "
            + "sum(case when i.status = com.tagback.domain.entity.ItemStatus.AVAILABLE then 1L else 0L end) as availableCount "
            + "from ItemType t join Item i on i.itemType = t "
            + "where (:typeId is null or t.id = :typeId) and "
            + "(lower(t.name) like :pattern escape '!' or exists (select m.id from Item m where m.itemType = t and lower(m.itemName) like :pattern escape '!')) "
            + "group by t.id, t.name having (:availableOnly = false or sum(case when i.status = com.tagback.domain.entity.ItemStatus.AVAILABLE then 1L else 0L end) > 0)",
            countQuery = "select count(t.id) from ItemType t where (:typeId is null or t.id = :typeId) "
            + "and exists (select i.id from Item i where i.itemType = t) "
            + "and (lower(t.name) like :pattern escape '!' or exists (select m.id from Item m where m.itemType = t and lower(m.itemName) like :pattern escape '!')) "
            + "and (:availableOnly = false or exists (select a.id from Item a where a.itemType = t and a.status = com.tagback.domain.entity.ItemStatus.AVAILABLE))")
    Page<CatalogRow> catalog(@Param("typeId") Long typeId, @Param("pattern") String pattern,
                             @Param("availableOnly") boolean availableOnly, Pageable pageable);
}
