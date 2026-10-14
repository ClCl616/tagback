CREATE TABLE rental_codes (
    rental_code_id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    code_hash VARCHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    CHECK (consumed_at IS NULL OR code_hash IS NULL)
);
CREATE UNIQUE INDEX uq_rental_code_active_user ON rental_codes(user_id) WHERE code_hash IS NOT NULL;
CREATE INDEX ix_rental_codes_user_created ON rental_codes(user_id, created_at);

CREATE TABLE rental_grants (
    rental_grant_id UUID PRIMARY KEY,
    rental_code_id UUID NOT NULL REFERENCES rental_codes(rental_code_id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > created_at)
);
CREATE INDEX ix_rental_grants_code ON rental_grants(rental_code_id);

-- Response snapshots preserve the original checkout even after later return/due-date changes.
CREATE TABLE rental_operations (
    rental_grant_id UUID NOT NULL REFERENCES rental_grants(rental_grant_id),
    idempotency_key UUID NOT NULL,
    item_id BIGINT NOT NULL REFERENCES items(item_id),
    item_type_id BIGINT NOT NULL REFERENCES item_types(item_type_id),
    rental_id BIGINT NOT NULL UNIQUE REFERENCES rentals(rental_id),
    rented_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (rental_grant_id, idempotency_key)
);

-- Fixed one-minute verification windows, shared by every application instance.
CREATE TABLE rental_verification_limits (
    scope_hash VARCHAR(64) PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL,
    attempts BIGINT NOT NULL CHECK (attempts > 0)
);
