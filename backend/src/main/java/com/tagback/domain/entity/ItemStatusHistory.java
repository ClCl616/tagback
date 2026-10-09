package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.Objects;

@Entity
@Table(name = "item_status_history")
public class ItemStatusHistory {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "item_status_history_id")
    private Long id;

    @Column(name = "item_id", nullable = false)
    private Long itemId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", nullable = false, length = 20)
    private ItemStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false, length = 20)
    private ItemStatus toStatus;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private ItemStatusChangeSource source;

    @Column(name = "changed_by_user_id")
    private Long changedByUserId;

    @Column(length = 500)
    private String reason;

    @Column(name = "changed_at", nullable = false, insertable = false, updatable = false)
    private OffsetDateTime changedAt;

    protected ItemStatusHistory() {}

    public ItemStatusHistory(Long itemId, ItemStatus fromStatus, ItemStatus toStatus,
                             ItemStatusChangeSource source, Long changedByUserId, String reason) {
        this.itemId = Objects.requireNonNull(itemId, "itemId");
        this.fromStatus = Objects.requireNonNull(fromStatus, "fromStatus");
        this.toStatus = Objects.requireNonNull(toStatus, "toStatus");
        this.source = Objects.requireNonNull(source, "source");
        this.changedByUserId = changedByUserId;
        this.reason = reason;
    }

    public Long getId() { return id; }
    public Long getItemId() { return itemId; }
    public ItemStatus getFromStatus() { return fromStatus; }
    public ItemStatus getToStatus() { return toStatus; }
    public ItemStatusChangeSource getSource() { return source; }
    public Long getChangedByUserId() { return changedByUserId; }
    public String getReason() { return reason; }
    public OffsetDateTime getChangedAt() { return changedAt; }
}
