package com.tagback;

import com.tagback.domain.entity.ItemType;
import com.tagback.domain.repository.ItemTypeRepository;
import com.tagback.service.ItemTypeService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@EnabledIfEnvironmentVariable(named = "TAGBACK_ITEM_DB_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.profiles.active=sms-mock",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:${TAGBACK_ITEM_DB_PORT:55440}/tagback_items_test",
        "spring.datasource.username=postgres", "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.open-in-view=false"})
@Transactional
class ItemTypeServicePostgresIntegrationTest {
    @Autowired ItemTypeRepository types;
    @Autowired ItemTypeService service;
    @Autowired JdbcTemplate jdbc;

    @Test
    void includesTypeWithoutAnyItem() {
        ItemType type = types.saveAndFlush(new ItemType("종류 목록 단독 테스트", null));
        assertTrue(service.list().itemTypes().stream().anyMatch(row ->
                row.itemTypeId().equals(type.getId().toString())
                        && row.itemTypeName().equals(type.getName())));
        assertEquals(0, jdbc.queryForObject("select count(*) from items where item_type_id = ?",
                Integer.class, type.getId()));
    }
}
