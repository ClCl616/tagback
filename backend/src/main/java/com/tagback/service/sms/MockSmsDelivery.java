package com.tagback.service.sms;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Component
@Profile("sms-mock & !prod & !production")
public class MockSmsDelivery {
    private final ConcurrentHashMap<UUID, Message> messages = new ConcurrentHashMap<>();
    private final Clock clock;

    public MockSmsDelivery(Clock clock) { this.clock = clock; }

    public void deliverAfterCommit(UUID id, String code, Instant expiresAt) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                messages.entrySet().removeIf(entry -> !entry.getValue().expiresAt().isAfter(clock.instant()));
                messages.put(id, new Message(code, expiresAt));
            }
        });
    }

    public Optional<String> findCode(UUID id) {
        Message message = messages.get(id);
        if (message == null) return Optional.empty();
        if (!message.expiresAt().isAfter(clock.instant())) {
            messages.remove(id, message);
            return Optional.empty();
        }
        return Optional.of(message.code());
    }

    private record Message(String code, Instant expiresAt) {
        @Override public String toString() { return "Message[redacted]"; }
    }
}
