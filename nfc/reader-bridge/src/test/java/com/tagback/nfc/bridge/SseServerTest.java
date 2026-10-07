package com.tagback.nfc.bridge;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.Socket;
import java.io.OutputStreamWriter;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SseServerTest {
    private static final String ORIGIN = "http://localhost:5173";

    @Test
    void sendsVersionOneEventsAsSseAndReplaysCurrentState() throws Exception {
        try (SseServer server = new SseServer(0, ORIGIN)) {
            server.start();
            assertTrue(server.bindAddress().isLoopbackAddress());
            server.publish(BridgeEvent.connected());
            server.publish(BridgeEvent.tagRead("04C8AB82492490"));
            HttpResponse<java.io.InputStream> response = connect(server, ORIGIN);
            try (var body = response.body()) {
                assertEquals(200, response.statusCode());
                assertEquals("text/event-stream; charset=utf-8",
                        response.headers().firstValue("Content-Type").orElse(null));
                assertEquals(ORIGIN, response.headers().firstValue("Access-Control-Allow-Origin").orElse(null));
                BufferedReader lines = new BufferedReader(new InputStreamReader(
                        body, StandardCharsets.UTF_8));
                assertEquals(": connected", lines.readLine());
                assertEquals("", lines.readLine());
                assertEvent(lines, "READER_CONNECTED", "{\"type\":\"READER_CONNECTED\"}");
                assertEvent(lines, "TAG_READ", "{\"type\":\"TAG_READ\",\"uid\":\"04C8AB82492490\"}");
                server.publish(BridgeEvent.tagRemoved());
                assertEvent(lines, "TAG_REMOVED", "{\"type\":\"TAG_REMOVED\"}");
                server.publish(BridgeEvent.disconnected());
                assertEvent(lines, "READER_DISCONNECTED", "{\"type\":\"READER_DISCONNECTED\"}");
            }
        }
    }

    @Test
    void rejectsUnapprovedBrowserOrigin() throws Exception {
        try (SseServer server = new SseServer(0, ORIGIN)) {
            server.start();
            HttpResponse<java.io.InputStream> response = connect(server, "http://unapproved.example");
            try (var body = response.body()) { assertEquals(403, response.statusCode()); }
        }
    }

    @Test
    void sendsPeriodicPingAndRemovesDisconnectedClient() throws Exception {
        try (SseServer server = new SseServer(0, ORIGIN, 50)) {
            server.start();
            HttpResponse<java.io.InputStream> response = connect(server, ORIGIN);
            try (var body = response.body()) {
                BufferedReader lines = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
                assertEquals(": connected", lines.readLine());
                assertEquals("", lines.readLine());
                assertEquals(": ping", lines.readLine());
                assertEquals("", lines.readLine());
            }
            awaitClientCount(server, 0);

            Socket dropped = new Socket("127.0.0.1", server.port());
            dropped.setSoTimeout(2_000);
            dropped.setSoLinger(true, 0);
            OutputStreamWriter request = new OutputStreamWriter(dropped.getOutputStream(), StandardCharsets.US_ASCII);
            request.write("GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: " + ORIGIN
                    + "\r\nConnection: keep-alive\r\n\r\n");
            request.flush();
            BufferedReader headers = new BufferedReader(new InputStreamReader(
                    dropped.getInputStream(), StandardCharsets.US_ASCII));
            while (!"".equals(headers.readLine())) { /* consume response headers */ }
            awaitClientCount(server, 1);
            dropped.close(); // TCP reset makes the next heartbeat write fail.
            awaitClientCount(server, 0);
        }
    }

    private static void awaitClientCount(SseServer server, int expected) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (server.clientCount() != expected && System.nanoTime() < deadline) Thread.sleep(20);
        assertEquals(expected, server.clientCount());
    }

    private static HttpResponse<java.io.InputStream> connect(SseServer server, String origin) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(
                        "http://127.0.0.1:" + server.port() + "/events"))
                .header("Origin", origin).timeout(Duration.ofSeconds(3)).GET().build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofInputStream());
    }

    private static void assertEvent(BufferedReader lines, String type, String json) throws Exception {
        assertEquals("event: " + type, lines.readLine());
        assertEquals("data: " + json, lines.readLine());
        assertEquals("", lines.readLine());
    }
}
