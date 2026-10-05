CREATE TABLE rentals (
                         rental_id BIGSERIAL PRIMARY KEY,
                         user_id BIGINT NOT NULL,
                         item_id BIGINT NOT NULL,

                         rented_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                         due_at TIMESTAMP WITH TIME ZONE NOT NULL,
                         returned_at TIMESTAMP WITH TIME ZONE,

                         status VARCHAR(20) NOT NULL DEFAULT 'RENTED',

                         CONSTRAINT fk_rentals_user
                             FOREIGN KEY (user_id)
                                 REFERENCES users(user_id),

                         CONSTRAINT fk_rentals_item
                             FOREIGN KEY (item_id)
                                 REFERENCES items(item_id),

                         CONSTRAINT chk_rentals_status
                             CHECK (status IN ('RENTED', 'RETURNED', 'OVERDUE'))
);