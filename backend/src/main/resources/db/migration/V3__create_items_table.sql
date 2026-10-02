CREATE TABLE items (
                       item_id BIGSERIAL PRIMARY KEY,
                       item_type_id BIGINT NOT NULL,
                       item_name VARCHAR(100) NOT NULL,
                       status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
                       created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

                       CONSTRAINT fk_items_item_type
                           FOREIGN KEY (item_type_id)
                               REFERENCES item_types(item_type_id),

                       CONSTRAINT chk_items_status
                           CHECK (status IN ('AVAILABLE', 'RENTED', 'INSPECTION', 'REPAIR'))
);