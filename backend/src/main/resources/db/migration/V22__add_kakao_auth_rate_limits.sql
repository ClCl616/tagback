-- Fixed-window counters for a development-only Kakao authentication implementation.
-- Keys are server-keyed digests, never raw addresses or Kakao identifiers.
CREATE TABLE kakao_auth_rate_limits (
    scope VARCHAR(30) NOT NULL,
    subject_hmac BYTEA NOT NULL CHECK (octet_length(subject_hmac) = 32),
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count > 0),
    PRIMARY KEY (scope, subject_hmac)
);
