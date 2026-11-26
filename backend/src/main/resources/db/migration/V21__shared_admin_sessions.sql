CREATE TABLE admin_sessions (
    session_id UUID PRIMARY KEY,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    password_version VARCHAR(64) NOT NULL,
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('WEB', 'KIOSK')),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE TABLE admin_login_limits (
    scope VARCHAR(30) PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL
);
CREATE TABLE admin_audit (
    audit_id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES admin_sessions(session_id),
    action VARCHAR(40) NOT NULL,
    item_id BIGINT NOT NULL,
    bridge_id VARCHAR(64),
    previous_uid VARCHAR(20),
    new_uid VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE item_status_history ADD COLUMN admin_session_id UUID REFERENCES admin_sessions(session_id);
ALTER TABLE item_status_history DROP CONSTRAINT chk_item_status_history_admin_actor;
ALTER TABLE item_status_history ADD CONSTRAINT chk_item_status_history_admin_actor
    CHECK (source <> 'ADMIN_API' OR changed_by_user_id IS NOT NULL OR admin_session_id IS NOT NULL);
CREATE TABLE admin_tag_operations (
    operation_id UUID PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL,
    response_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
