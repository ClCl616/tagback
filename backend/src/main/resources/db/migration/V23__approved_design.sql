CREATE TABLE administrators (
 admin_number VARCHAR(3) PRIMARY KEY CHECK (admin_number ~ '^[0-9]{3}$'),
 name VARCHAR(80) NOT NULL,
 password_hash TEXT NOT NULL,
 must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE admin_sessions ADD COLUMN admin_number VARCHAR(3) REFERENCES administrators;
ALTER TABLE admin_sessions ADD COLUMN admin_name VARCHAR(80);
UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
CREATE TABLE item_images (
 image_id UUID PRIMARY KEY,
 content BYTEA NOT NULL,
 media_type VARCHAR(30) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE items ADD COLUMN image_id UUID REFERENCES item_images;
ALTER TABLE item_types ADD COLUMN image_id UUID REFERENCES item_images;

CREATE TABLE rental_code_revisions (user_id BIGINT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE, revision BIGINT NOT NULL DEFAULT 0);
ALTER TABLE rental_codes ADD COLUMN completion_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE rental_codes ADD COLUMN lookup_hash VARCHAR(64);
UPDATE rental_codes SET lookup_hash=code_hash;
CREATE INDEX rental_codes_retired_lookup ON rental_codes(lookup_hash,expires_at);
