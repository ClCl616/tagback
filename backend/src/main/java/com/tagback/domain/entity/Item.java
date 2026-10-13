package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "items")
public class Item {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "item_id")
    private Long id;

    @Column(name = "item_name", nullable = false, length = 100)
    private String itemName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ItemStatus status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "item_type_id", nullable = false)
    private ItemType itemType;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected Item() {
    }

    public Item(String itemName, ItemStatus status, ItemType itemType) {
        this.itemName = itemName;
        this.status = status;
        this.itemType = itemType;
    }

    public Long getId() {
        return id;
    }

    public String getItemName() {
        return itemName;
    }

    public ItemStatus getStatus() {
        return status;
    }

    public ItemType getItemType() {
        return itemType;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    /** Called only after an NFC tag has been persisted for this item. */
    public void markAvailable() {
        this.status = ItemStatus.AVAILABLE;
    }

    public void updateStatus(ItemStatus status) {
        this.status = java.util.Objects.requireNonNull(status, "status");
    }

    /** The service checks permissions and history before changing the item type. */
    public void updateDetails(String itemName, ItemType itemType) {
        String normalizedName = java.util.Objects.requireNonNull(itemName, "itemName").strip();
        if (normalizedName.isBlank() || normalizedName.length() > 100) {
            throw new IllegalArgumentException("itemName must contain 1 to 100 characters");
        }
        ItemType validatedType = java.util.Objects.requireNonNull(itemType, "itemType");
        this.itemName = normalizedName;
        this.itemType = validatedType;
    }
}
