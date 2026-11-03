ALTER TABLE rentals
    ADD COLUMN return_condition VARCHAR(20);

ALTER TABLE rentals
    ADD CONSTRAINT chk_rentals_return_condition
    CHECK (return_condition IS NULL OR return_condition IN ('NORMAL', 'DAMAGED'));
