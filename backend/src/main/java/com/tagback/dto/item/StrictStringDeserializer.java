package com.tagback.dto.item;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.deser.std.StdDeserializer;

/** Do not silently coerce JSON numbers or booleans into item names or IDs. */
public final class StrictStringDeserializer extends StdDeserializer<String> {
    public StrictStringDeserializer() { super(String.class); }

    @Override
    public String deserialize(JsonParser parser, DeserializationContext context) {
        if (!parser.hasToken(JsonToken.VALUE_STRING)) {
            throw new IllegalArgumentException("Expected a JSON string");
        }
        return parser.getString();
    }
}
