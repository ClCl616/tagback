package com.tagback.domain.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.Objects;

@Entity
@Table(name = "rentals")
public class Rental {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "rental_id")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, updatable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "item_id", nullable = false, updatable = false)
    private Item item;

    @Column(name = "rented_at", nullable = false, updatable = false)
    private Instant rentedAt;

    @Column(name = "due_at", nullable = false)
    private Instant dueAt;

    @Column(name = "returned_at")
    private Instant returnedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private RentalStatus status = RentalStatus.RENTED;

    protected Rental() {}

    /** The checkout service supplies one server time and the calculated due date. */
    public Rental(User user, Item item, Instant rentedAt, Instant dueAt) {
        this.user = Objects.requireNonNull(user, "user");
        this.item = Objects.requireNonNull(item, "item");
        this.rentedAt = Objects.requireNonNull(rentedAt, "rentedAt");
        this.dueAt = Objects.requireNonNull(dueAt, "dueAt");
    }

    public Long getId() { return id; }
    public User getUser() { return user; }
    public Item getItem() { return item; }
    public Instant getRentedAt() { return rentedAt; }
    public Instant getDueAt() { return dueAt; }
    public Instant getReturnedAt() { return returnedAt; }
    public RentalStatus getStatus() { return status; }
}
