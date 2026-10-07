-- Preserve existing users and rental FKs. Legacy hashes are NOT PIN hashes.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN pin_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pin_locked_until TIMESTAMPTZ;
ALTER TABLE users ADD CONSTRAINT chk_users_pin_failures CHECK (pin_failed_count BETWEEN 0 AND 20);
ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('USER', 'ADMIN'));
ALTER TABLE users ADD CONSTRAINT chk_users_credential CHECK (pin_hash IS NOT NULL OR password_hash IS NOT NULL);

-- Normalize supported legacy numbers without changing user IDs. A collision fails
-- the migration transaction rather than merging accounts or deleting records.
UPDATE users SET phone_number = '+82' || substring(regexp_replace(phone_number, '[[:space:]-]', '', 'g') FROM 2)
 WHERE regexp_replace(phone_number, '[[:space:]-]', '', 'g') ~ '^010[0-9]{8}$';
UPDATE users SET phone_number = regexp_replace(phone_number, '[[:space:]-]', '', 'g')
 WHERE regexp_replace(phone_number, '[[:space:]-]', '', 'g') ~ '^\+8210[0-9]{8}$';

-- One lockable row per number; all SMS purposes share the resend/volume gate.
CREATE TABLE sms_request_gates (
    phone_number VARCHAR(20) PRIMARY KEY,
    resend_available_at TIMESTAMPTZ,
    CONSTRAINT chk_sms_gate_phone CHECK (phone_number ~ '^\+8210[0-9]{8}$')
);

CREATE TABLE sms_verifications (
    sms_verification_id UUID PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL REFERENCES sms_request_gates(phone_number),
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('SIGNUP', 'LOGIN', 'PIN_RESET', 'PHONE_CHANGE')),
    code_hash VARCHAR(255) NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 5),
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
    sent_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    resend_available_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > created_at),
    CHECK (resend_available_at > created_at),
    CHECK ((delivery_status = 'SENT') = (sent_at IS NOT NULL))
);
CREATE INDEX ix_sms_sent_window ON sms_verifications(phone_number, sent_at) WHERE delivery_status = 'SENT';
CREATE INDEX ix_sms_pending ON sms_verifications(phone_number, created_at) WHERE delivery_status = 'PENDING';
CREATE UNIQUE INDEX uq_sms_unfinished ON sms_verifications(phone_number, purpose)
 WHERE verified_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE verification_grants (
    verification_grant_id UUID PRIMARY KEY,
    sms_verification_id UUID NOT NULL UNIQUE REFERENCES sms_verifications(sms_verification_id),
    phone_number VARCHAR(20) NOT NULL,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('SIGNUP', 'LOGIN', 'PIN_RESET', 'PHONE_CHANGE')),
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > created_at)
);

CREATE TABLE browser_registrations (
    browser_registration_id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    registration_token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (browser_registration_id, user_id),
    CHECK (expires_at > created_at)
);
-- Expired rows must also be revoked before inserting a replacement.
CREATE UNIQUE INDEX uq_browser_not_revoked ON browser_registrations(user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_sessions (
    login_session_id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    browser_registration_id UUID NOT NULL,
    session_token_hash VARCHAR(255) NOT NULL UNIQUE,
    last_activity_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(30) CHECK (revoked_reason IN ('LOGOUT', 'SESSION_REPLACED', 'REGISTRATION_REMOVED', 'PIN_RESET', 'EXPIRED')),
    created_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (browser_registration_id, user_id) REFERENCES browser_registrations(browser_registration_id, user_id),
    CHECK (idle_expires_at > last_activity_at),
    CHECK (absolute_expires_at > created_at),
    CHECK (idle_expires_at <= absolute_expires_at),
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE UNIQUE INDEX uq_session_not_revoked ON login_sessions(browser_registration_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_sessions_user ON login_sessions(user_id);

-- caller_scope_hash is a hash of a server-issued caller context, never an arbitrary user ID.
-- request_fingerprint must be a keyed digest when inputs include low-entropy PIN/SMS codes.
CREATE TABLE auth_operations (
    operation_id UUID PRIMARY KEY,
    caller_scope_hash VARCHAR(255) NOT NULL,
    operation_type VARCHAR(40) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')),
    result_json TEXT,
    error_code VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    UNIQUE (caller_scope_hash, operation_type, idempotency_key),
    CHECK (expires_at > created_at),
    CHECK ((status = 'PROCESSING') = (completed_at IS NULL))
);
