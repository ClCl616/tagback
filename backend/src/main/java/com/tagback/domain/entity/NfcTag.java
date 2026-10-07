package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "nfc_tags")
public class NfcTag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "nfc_tag_id")
    private Long id;

    @Column(name = "tag_uid", nullable = false, unique = true, length = 100)
    private String uid;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "item_id", nullable = false, unique = true)
    private Item item;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private OffsetDateTime createdAt;

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
}
