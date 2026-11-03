CREATE TABLE nfc_scan_proof_uses (
    nonce UUID PRIMARY KEY,
    tag_uid VARCHAR(100) NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_nfc_scan_proof_uses_consumed_at ON nfc_scan_proof_uses(consumed_at);
