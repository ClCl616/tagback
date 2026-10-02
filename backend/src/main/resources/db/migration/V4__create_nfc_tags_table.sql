CREATE TABLE nfc_tags (
                          nfc_tag_id BIGSERIAL PRIMARY KEY,
                          item_id BIGINT NOT NULL UNIQUE,
                          tag_uid VARCHAR(100) NOT NULL UNIQUE,
                          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

                          CONSTRAINT fk_nfc_tags_item
                              FOREIGN KEY (item_id)
                                  REFERENCES items(item_id)
);