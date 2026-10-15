package com.tagback.nfc.reader;

/** One observation of the reader and card, independent of PC/SC. */
public interface ReaderSource {
    ReaderSnapshot poll() throws Exception;
}
