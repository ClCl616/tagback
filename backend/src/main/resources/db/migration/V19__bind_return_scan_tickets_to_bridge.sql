-- Tickets from the previous schema are short-lived bearer values; invalidate them during upgrade.
DELETE FROM nfc_return_scan_tickets;

ALTER TABLE nfc_return_scan_tickets
    ADD COLUMN bridge_id VARCHAR(64) NOT NULL,
    ADD COLUMN proof_nonce UUID NOT NULL;
