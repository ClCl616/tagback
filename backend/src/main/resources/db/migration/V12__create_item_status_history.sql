CREATE TABLE item_status_history (
    item_status_history_id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL,
    from_status VARCHAR(20) NOT NULL CHECK (from_status IN ('TAG_PENDING', 'AVAILABLE', 'RENTED', 'INSPECTION', 'REPAIR')),
    to_status VARCHAR(20) NOT NULL CHECK (to_status IN ('TAG_PENDING', 'AVAILABLE', 'RENTED', 'INSPECTION', 'REPAIR')),
    source VARCHAR(30) NOT NULL CHECK (source IN ('ADMIN_API', 'TAG_REGISTRATION', 'RENTAL_FLOW')),
    changed_by_user_id BIGINT REFERENCES users(user_id),
    reason VARCHAR(500),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_item_status_history_item FOREIGN KEY (item_id) REFERENCES items(item_id),
    CONSTRAINT chk_item_status_history_change CHECK (from_status <> to_status),
    CONSTRAINT chk_item_status_history_admin_actor CHECK (source <> 'ADMIN_API' OR changed_by_user_id IS NOT NULL)
);

CREATE INDEX ix_item_status_history_item_changed
    ON item_status_history(item_id, changed_at DESC, item_status_history_id DESC);
