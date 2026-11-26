-- Additive foundation only: do not link or delete existing accounts or SMS data.
-- Existing SMS flows still require a phone number in application code.
ALTER TABLE users ALTER COLUMN phone_number DROP NOT NULL;

-- botUserKey is scoped to a bot. Only an explicitly verified identity may be linked.
-- Deleting a link on withdrawal permits the same identity to register again.
CREATE TABLE kakao_bot_identities (
    user_id BIGINT PRIMARY KEY REFERENCES users(user_id),
    bot_id VARCHAR(100) NOT NULL CHECK (length(trim(bot_id)) > 0),
    bot_user_key VARCHAR(70) NOT NULL CHECK (length(trim(bot_user_key)) > 0),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_kakao_bot_identity UNIQUE (bot_id, bot_user_key)
);

-- HMACs are distinct domain-separated server-keyed digests, never raw secrets.
-- Implementations must use a stable, protected server key and rotation strategy.
CREATE TABLE kakao_auth_challenges (
    challenge_id UUID PRIMARY KEY,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('SIGNUP', 'LOGIN', 'PIN_RESET')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'CONSUMED', 'CANCELED', 'EXPIRED')),
    code_hmac BYTEA NOT NULL CHECK (octet_length(code_hmac) = 32),
    browser_proof_hmac BYTEA NOT NULL CHECK (octet_length(browser_proof_hmac) = 32),
    bot_id VARCHAR(100),
    bot_user_key VARCHAR(70),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    CHECK ((bot_id IS NULL) = (bot_user_key IS NULL)),
    CHECK (bot_id IS NULL OR (length(trim(bot_id)) > 0 AND length(trim(bot_user_key)) > 0)),
    CHECK ((verified_at IS NULL) = (bot_id IS NULL)),
    CHECK (verified_at IS NULL OR (verified_at >= created_at AND verified_at < expires_at)),
    CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL)),
    CHECK (consumed_at IS NULL OR (verified_at IS NOT NULL AND consumed_at >= verified_at AND consumed_at < expires_at)),
    CHECK (status <> 'PENDING' OR verified_at IS NULL),
    CHECK (status NOT IN ('VERIFIED', 'CONSUMED') OR verified_at IS NOT NULL)
);
-- The application must mark expired requests terminal before reusing a code.
CREATE UNIQUE INDEX uq_kakao_live_code ON kakao_auth_challenges(code_hmac)
    WHERE status IN ('PENDING', 'VERIFIED');
CREATE INDEX ix_kakao_challenges_expiry ON kakao_auth_challenges(expires_at)
    WHERE status IN ('PENDING', 'VERIFIED');
