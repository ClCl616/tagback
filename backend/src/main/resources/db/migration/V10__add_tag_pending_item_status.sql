ALTER TABLE items ALTER COLUMN status DROP DEFAULT;
ALTER TABLE items DROP CONSTRAINT chk_items_status;

UPDATE items i
SET status = 'TAG_PENDING'
WHERE i.status = 'AVAILABLE'
  AND NOT EXISTS (SELECT 1 FROM nfc_tags t WHERE t.item_id = i.item_id);

ALTER TABLE items
    ADD CONSTRAINT chk_items_status
        CHECK (status IN ('TAG_PENDING', 'AVAILABLE', 'RENTED', 'INSPECTION', 'REPAIR'));
ALTER TABLE items ALTER COLUMN status SET DEFAULT 'TAG_PENDING';
