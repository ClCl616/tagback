CREATE FUNCTION enforce_available_items_have_tags() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'AVAILABLE'
       AND NOT EXISTS (SELECT 1 FROM nfc_tags WHERE item_id = NEW.item_id) THEN
        RAISE EXCEPTION 'AVAILABLE items require an NFC tag'
            USING ERRCODE = '23514', CONSTRAINT = 'chk_available_item_has_tag';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_items_available_requires_tag
    BEFORE INSERT OR UPDATE OF status ON items
    FOR EACH ROW EXECUTE FUNCTION enforce_available_items_have_tags();

CREATE FUNCTION prevent_removing_tag_from_available_item() RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    item_status VARCHAR(20);
BEGIN
    SELECT status INTO item_status
    FROM items
    WHERE item_id = OLD.item_id
    FOR UPDATE;

    IF item_status = 'AVAILABLE' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'AVAILABLE items must keep their NFC tag'
                USING ERRCODE = '23514', CONSTRAINT = 'chk_available_item_has_tag';
        ELSIF NEW.item_id IS DISTINCT FROM OLD.item_id THEN
            RAISE EXCEPTION 'AVAILABLE items must keep their NFC tag'
                USING ERRCODE = '23514', CONSTRAINT = 'chk_available_item_has_tag';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_available_item_keeps_tag
    BEFORE DELETE OR UPDATE OF item_id ON nfc_tags
    FOR EACH ROW EXECUTE FUNCTION prevent_removing_tag_from_available_item();
