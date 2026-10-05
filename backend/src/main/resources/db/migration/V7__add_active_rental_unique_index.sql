CREATE UNIQUE INDEX uq_active_rental_item
    ON rentals(item_id)
    WHERE returned_at IS NULL;