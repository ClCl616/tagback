-- Additive transition: never merge legacy users by name or destroy rental FKs.
ALTER TABLE users ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE users ADD COLUMN kakao_user_id BIGINT UNIQUE CHECK (kakao_user_id > 0);
ALTER TABLE users DROP CONSTRAINT chk_users_credential;
ALTER TABLE users ADD CONSTRAINT chk_users_credential CHECK
    (kakao_user_id IS NOT NULL OR pin_hash IS NOT NULL OR password_hash IS NOT NULL);
ALTER TABLE login_sessions ADD COLUMN oauth_flow_hash VARCHAR(64);
CREATE INDEX ix_session_oauth_flow ON login_sessions(oauth_flow_hash) WHERE oauth_flow_hash IS NOT NULL;

CREATE TABLE oauth_attempts (
    state_hash VARCHAR(64) PRIMARY KEY,
    browser_hash VARCHAR(64) NOT NULL,
    next_path VARCHAR(300) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    kakao_user_id BIGINT,
    nickname VARCHAR(40),
    completed_user_id BIGINT REFERENCES users(user_id)
);
CREATE INDEX ix_oauth_expiry ON oauth_attempts(expires_at);
CREATE UNIQUE INDEX uq_oauth_browser ON oauth_attempts(browser_hash);
CREATE TABLE oauth_start_limits (
    scope_hash VARCHAR(64) NOT NULL,
    window_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL,
    PRIMARY KEY(scope_hash, window_at)
);
