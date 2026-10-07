package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Entity
@Table(name = "nfc_tags")
public class NfcTag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "nfc_tag_id")
    private Long id;

    @Column(name = "tag_uid", nullable = false, unique = true, length = 100)
    private String uid;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "item_id", nullable = false)
    private Item item;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "deactivated_at")
    private OffsetDateTime deactivatedAt;

    protected NfcTag() {
    }

    public NfcTag(String uid, Item item) {
        this.uid = uid;
        this.item = item;
    }

    public Long getId() {
        return id;
    }

    public String getUid() {
        return uid;
    }

    public Item getItem() {
        return item;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public OffsetDateTime getDeactivatedAt() {
        return deactivatedAt;
    }

    public void deactivate() {
        if (deactivatedAt == null) {
            deactivatedAt = OffsetDateTime.now(ZoneOffset.UTC);
        }
    }
}
