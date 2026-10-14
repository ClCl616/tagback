-- V11 checks for any historical tag immediately. Replace it with a final-state
-- check so replacement and deactivation can update tags and item status together.
DROP TRIGGER trg_items_available_requires_tag ON items;
DROP TRIGGER trg_available_item_keeps_tag ON nfc_tags;
DROP FUNCTION enforce_available_items_have_tags();
DROP FUNCTION prevent_removing_tag_from_available_item();

DO $$
DECLARE
    violating_ids BIGINT[];
BEGIN
    SELECT array_agg(i.item_id ORDER BY i.item_id) INTO violating_ids
    FROM items i
    WHERE i.status = 'AVAILABLE'
      AND NOT EXISTS (
          SELECT 1 FROM nfc_tags t
          WHERE t.item_id = i.item_id AND t.deactivated_at IS NULL
      );
    IF violating_ids IS NOT NULL THEN
        RAISE EXCEPTION 'AVAILABLE items without active NFC tags: item_ids=%', violating_ids
            USING ERRCODE = '23514', CONSTRAINT = 'chk_available_item_has_active_tag';
    END IF;
END;
$$;

CREATE FUNCTION check_available_item_active_tag(target_item_id BIGINT) RETURNS void
    LANGUAGE plpgsql
AS $$
DECLARE
    current_status VARCHAR(20);
BEGIN
    -- Serialize tag changes with item-status changes for this item.
    SELECT status INTO current_status FROM items WHERE item_id = target_item_id FOR UPDATE;
    IF current_status = 'AVAILABLE'
       AND NOT EXISTS (
           SELECT 1 FROM nfc_tags
           WHERE item_id = target_item_id AND deactivated_at IS NULL
       ) THEN
        RAISE EXCEPTION 'AVAILABLE item % requires an active NFC tag', target_item_id
            USING ERRCODE = '23514', CONSTRAINT = 'chk_available_item_has_active_tag';
    END IF;
END;
$$;

CREATE FUNCTION check_available_item_active_tag_from_item() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM check_available_item_active_tag(NEW.item_id);
    RETURN NULL;
END;
$$;

CREATE FUNCTION check_available_item_active_tag_from_tag() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM check_available_item_active_tag(OLD.item_id);
    ELSIF TG_OP = 'INSERT' THEN
        PERFORM check_available_item_active_tag(NEW.item_id);
    ELSE
        PERFORM check_available_item_active_tag(OLD.item_id);
        IF NEW.item_id IS DISTINCT FROM OLD.item_id THEN
            PERFORM check_available_item_active_tag(NEW.item_id);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_items_require_active_tag
    AFTER INSERT OR UPDATE ON items
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_available_item_active_tag_from_item();

CREATE CONSTRAINT TRIGGER trg_nfc_tags_require_active_tag
    AFTER INSERT OR UPDATE OR DELETE ON nfc_tags
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_available_item_active_tag_from_tag();
