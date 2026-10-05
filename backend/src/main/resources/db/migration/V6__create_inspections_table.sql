CREATE TABLE inspections (
                             inspection_id BIGSERIAL PRIMARY KEY,
                             item_id BIGINT NOT NULL,

                             inspection_type VARCHAR(20) NOT NULL,
                             status VARCHAR(20) NOT NULL,
                             note VARCHAR(500),

                             inspected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

                             CONSTRAINT fk_inspections_item
                                 FOREIGN KEY (item_id)
                                     REFERENCES items(item_id),

                             CONSTRAINT chk_inspection_type
                                 CHECK (inspection_type IN ('RETURN', 'MANUAL')),

                             CONSTRAINT chk_inspection_status
                                 CHECK (status IN ('NORMAL', 'DAMAGED', 'REPAIR'))
);