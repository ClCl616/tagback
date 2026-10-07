package com.tagback;

import com.tagback.domain.entity.Item;
import com.tagback.domain.entity.ItemStatus;
import com.tagback.domain.entity.ItemType;
import com.tagback.domain.repository.ItemRepository;
import com.tagback.domain.repository.ItemTypeRepository;
import com.tagback.exception.TagRegistrationException;
import com.tagback.service.TagRegistrationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "TAGBACK_DB_PASSWORD", matches = ".+")
class TagRegistrationConcurrencyIntegrationTest {
    @Autowired
    private ItemTypeRepository itemTypeRepository;
    @Autowired
    private ItemRepository itemRepository;
    @Autowired
    private TagRegistrationService registrationService;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private TransactionTemplate transactionTemplate;

    @Test
    void concurrentRegistrationOfOneUidReturnsOneSuccessAndOneConflict() throws Exception {
        TestItems data = transactionTemplate.execute(status -> {
            ItemType type = itemTypeRepository.saveAndFlush(
                    new ItemType("경합 테스트 " + UUID.randomUUID(), null));
            Item first = itemRepository.saveAndFlush(new Item("테스트 A", ItemStatus.AVAILABLE, type));
            Item second = itemRepository.saveAndFlush(new Item("테스트 B", ItemStatus.AVAILABLE, type));
            return new TestItems(type.getId(), first.getId(), second.getId());
        });
        String uid = UUID.randomUUID().toString().replace("-", "").substring(0, 14).toUpperCase();
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);

        try {
            Future<String> first = workers.submit(() -> registerAfterSignal(data.firstId(), uid, start));
            Future<String> second = workers.submit(() -> registerAfterSignal(data.secondId(), uid, start));
            start.countDown();

            List<String> outcomes = List.of(first.get(15, TimeUnit.SECONDS), second.get(15, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter("CREATED"::equals).count());
            assertEquals(1, outcomes.stream().filter("TAG_ALREADY_REGISTERED"::equals).count());
            assertEquals(1L, jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM nfc_tags WHERE tag_uid = ?", Long.class, uid));
        } finally {
            workers.shutdownNow();
            jdbcTemplate.update("DELETE FROM nfc_tags WHERE item_id IN (?, ?)", data.firstId(), data.secondId());
            jdbcTemplate.update("DELETE FROM items WHERE item_id IN (?, ?)", data.firstId(), data.secondId());
            jdbcTemplate.update("DELETE FROM item_types WHERE item_type_id = ?", data.typeId());
        }
    }

    @Test
    void concurrentRetryOfSameItemAndUidCreatesOnlyOneTag() throws Exception {
        TestItem data = transactionTemplate.execute(status -> {
            ItemType type = itemTypeRepository.saveAndFlush(
                    new ItemType("동일 물품 재시도 " + UUID.randomUUID(), null));
            Item item = itemRepository.saveAndFlush(new Item("테스트 물품", ItemStatus.AVAILABLE, type));
            return new TestItem(type.getId(), item.getId());
        });
        String uid = UUID.randomUUID().toString().replace("-", "").substring(0, 14).toUpperCase();
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);

        try {
            Future<TagRegistrationService.RegistrationResult> first = workers.submit(() -> {
                start.await();
                return registrationService.register(data.itemId(), uid);
            });
            Future<TagRegistrationService.RegistrationResult> second = workers.submit(() -> {
                start.await();
                return registrationService.register(data.itemId(), uid);
            });
            start.countDown();

            List<TagRegistrationService.RegistrationResult> results = List.of(
                    first.get(15, TimeUnit.SECONDS), second.get(15, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter(TagRegistrationService.RegistrationResult::created).count());
            assertEquals(results.get(0).response().tag().tagId(), results.get(1).response().tag().tagId());
            assertEquals(1L, jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM nfc_tags WHERE item_id = ? AND tag_uid = ?",
                    Long.class, data.itemId(), uid));
        } finally {
            workers.shutdownNow();
            jdbcTemplate.update("DELETE FROM nfc_tags WHERE item_id = ?", data.itemId());
            jdbcTemplate.update("DELETE FROM items WHERE item_id = ?", data.itemId());
            jdbcTemplate.update("DELETE FROM item_types WHERE item_type_id = ?", data.typeId());
        }
    }

    private String registerAfterSignal(Long itemId, String uid, CountDownLatch start) throws InterruptedException {
        start.await();
        try {
            return registrationService.register(itemId, uid).created() ? "CREATED" : "EXISTING";
        } catch (TagRegistrationException exception) {
            return exception.code();
        }
    }

    private record TestItems(Long typeId, Long firstId, Long secondId) {
    }

    private record TestItem(Long typeId, Long itemId) {
    }
}
