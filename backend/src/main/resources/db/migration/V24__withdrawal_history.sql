-- Detached history deliberately contains no user, former rental ID, or stable per-user identifier.
CREATE TABLE withdrawn_rental_history (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL,
    rented_date DATE NOT NULL,
    due_date DATE NOT NULL,
    returned_date DATE NOT NULL,
    return_condition VARCHAR(20),
    delete_after TIMESTAMPTZ NOT NULL,
    CONSTRAINT chk_withdrawn_return_condition CHECK (return_condition IS NULL OR return_condition IN ('NORMAL', 'DAMAGED'))
);
CREATE INDEX ix_withdrawn_history_delete_after ON withdrawn_rental_history(delete_after);

-- Historical admin actions remain, but the actor can no longer be linked after withdrawal.
ALTER TABLE item_status_history DROP CONSTRAINT chk_item_status_history_admin_actor;
ALTER TABLE item_status_history ADD COLUMN actor_withdrawn BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE item_status_history ADD CONSTRAINT chk_item_status_history_admin_actor
    CHECK (source <> 'ADMIN_API' OR changed_by_user_id IS NOT NULL OR admin_session_id IS NOT NULL OR actor_withdrawn);
ALTER TABLE item_status_history ADD CONSTRAINT chk_item_status_history_withdrawn_actor
    CHECK (NOT actor_withdrawn OR changed_by_user_id IS NULL);
