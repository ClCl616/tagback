ALTER TABLE nfc_tags DROP CONSTRAINT nfc_tags_item_id_key;

ALTER TABLE nfc_tags ADD COLUMN deactivated_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX uq_nfc_tags_active_item ON nfc_tags(item_id)
    WHERE deactivated_at IS NULL;
