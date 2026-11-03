package com.tagback.domain.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcReturnInspectionWriter implements ReturnInspectionWriter {
    private final JdbcTemplate jdbc;

    public JdbcReturnInspectionWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void recordDamagedReturn(Long itemId) {
        jdbc.update("insert into inspections (item_id, inspection_type, status, note) "
                + "values (?, 'RETURN', 'DAMAGED', '키오스크 반납 중 손상 확인')", itemId);
    }
}
