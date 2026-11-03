CREATE TABLE nfc_return_scan_tickets (
    ticket_id UUID PRIMARY KEY,
    tag_uid VARCHAR(100) NOT NULL,
    item_id BIGINT NOT NULL,
    rental_id BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT fk_nfc_return_scan_ticket_item FOREIGN KEY (item_id) REFERENCES items(item_id),
    CONSTRAINT fk_nfc_return_scan_ticket_rental FOREIGN KEY (rental_id) REFERENCES rentals(rental_id)
);

CREATE INDEX ix_nfc_return_scan_tickets_expiry ON nfc_return_scan_tickets(expires_at)
    WHERE consumed_at IS NULL;
