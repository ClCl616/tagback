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
}
