package com.tagback.nfc.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Loopback-only SSE endpoint with one explicitly allowed browser origin. */
public final class SseServer implements AutoCloseable {
    private final HttpServer server;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final String allowedOrigin;
    private final Set<Client> clients = new HashSet<>();
    private BridgeEvent readerState;
    private BridgeEvent tagState;

    public SseServer(int port, String allowedOrigin) throws IOException {
        this.allowedOrigin = allowedOrigin;
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 0);
        server.createContext("/events", this::handle);
        server.setExecutor(executor);
    }

    public void start() { server.start(); }

    public int port() { return server.getAddress().getPort(); }

    public InetAddress bindAddress() { return server.getAddress().getAddress(); }

    public synchronized void publish(BridgeEvent event) {
        switch (event.type()) {
            case READER_CONNECTED -> readerState = event;
            case READER_DISCONNECTED -> { readerState = event; tagState = null; }
            case TAG_READ -> tagState = event;
            case TAG_REMOVED -> tagState = null;
        }
        for (Client client : Set.copyOf(clients)) {
            try {
                client.send(event.sse());
            } catch (IOException exception) {
                clients.remove(client);
                client.close();
            }
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        if (!"/events".equals(exchange.getRequestURI().getPath())) {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
            return;
        }
        if (!"GET".equals(exchange.getRequestMethod())) {
            exchange.getResponseHeaders().set("Allow", "GET");
            exchange.sendResponseHeaders(405, -1);
            exchange.close();
            return;
        }
        String origin = exchange.getRequestHeaders().getFirst("Origin");
        if (origin != null && !allowedOrigin.equals(origin)) {
            exchange.sendResponseHeaders(403, -1);
            exchange.close();
            return;
        }
        exchange.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-cache");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.getResponseHeaders().set("Vary", "Origin");
        if (origin != null) exchange.getResponseHeaders().set("Access-Control-Allow-Origin", allowedOrigin);
        exchange.sendResponseHeaders(200, 0);

        Client client = new Client(exchange.getResponseBody());
        try {
            synchronized (this) {
                clients.add(client);
                client.send(": connected\n\n");
                if (readerState != null) client.send(readerState.sse());
                if (tagState != null) client.send(tagState.sse());
            }
            client.await();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        } finally {
            synchronized (this) { clients.remove(client); }
            client.close();
            exchange.close();
        }
    }

    @Override
    public void close() {
        synchronized (this) {
            for (Client client : Set.copyOf(clients)) client.close();
            clients.clear();
        }
        server.stop(0);
        executor.shutdownNow();
    }

    private static final class Client {
        private final OutputStream output;
        private final CountDownLatch closed = new CountDownLatch(1);

        private Client(OutputStream output) { this.output = output; }

        private synchronized void send(String text) throws IOException {
            output.write(text.getBytes(StandardCharsets.UTF_8));
            output.flush();
        }

        private void await() throws InterruptedException { closed.await(); }

        private void close() {
            closed.countDown();
            try { output.close(); } catch (IOException ignored) { }
        }
    }
}
