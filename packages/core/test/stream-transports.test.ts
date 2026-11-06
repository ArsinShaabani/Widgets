import { describe, expect, it, vi } from 'vitest';
import { WebSocketTransport, type SocketFactory, type SocketLike } from '../src/transport/websocket';
import { SseTransport } from '../src/transport/sse';
import { WidgetStore } from '../src/store';
import { createMockSnapshot } from '../src/mock';
import type { WidgetSnapshot } from '../src/types';

/** Controllable socket double that mimics the DOM WebSocket surface. */
function createSocketHarness() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: string[] = [];
  let closed = false;

  const socket: SocketLike = {
    readyState: 1,
    send: (data: string) => sent.push(data),
    close: () => {
      closed = true;
      socket.readyState = 3;
    },
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener as (...args: unknown[]) => void]);
    },
  };

  const emit = (type: string, ...args: unknown[]) => {
    for (const listener of listeners.get(type) ?? []) listener(...args);
  };

  const factory = function (this: unknown) {
    return socket;
  } as unknown as SocketFactory;

  return {
    factory,
    sent,
    emit,
    isClosed: () => closed,
    socket,
  };
}

describe('WebSocketTransport', () => {
  it('constructs the socket, subscribes and ingests snapshots', async () => {
    const harness = createSocketHarness();
    const received: WidgetSnapshot[] = [];
    const transport = new WebSocketTransport({ url: 'wss://example.test/stream', socketFactory: harness.factory });
    transport.subscribe('snapshot', (snapshot) => received.push(snapshot));

    await transport.start();
    harness.emit('open');
    expect(harness.sent[0]).toContain('"type":"subscribe"');

    harness.emit('message', { data: JSON.stringify({ data: createMockSnapshot({ elapsedSeconds: 4 }) }) });
    expect(received).toHaveLength(1);
    expect(transport.status.state).toBe('live');
    expect(transport.status.received).toBe(1);

    // Heartbeat frames are ignored by the parser.
    harness.emit('message', { data: 'pong' });
    expect(received).toHaveLength(1);
  });

  it('accepts Node style Buffer frames', async () => {
    const harness = createSocketHarness();
    const received: WidgetSnapshot[] = [];
    const transport = new WebSocketTransport({ url: 'wss://example.test/stream', socketFactory: harness.factory });
    transport.subscribe('snapshot', (snapshot) => received.push(snapshot));
    await transport.start();
    harness.emit('open');

    const payload = Buffer.from(JSON.stringify(createMockSnapshot({ elapsedSeconds: 3 })), 'utf8');
    harness.emit('message', payload);
    harness.emit('message', { data: payload });

    expect(received).toHaveLength(2);
  });

  it('reconnects with backoff when the socket closes', async () => {
    vi.useFakeTimers();
    const harness = createSocketHarness();
    const errors: Error[] = [];
    const transport = new WebSocketTransport({
      url: 'wss://example.test/stream',
      socketFactory: harness.factory,
      backoff: { baseDelay: 10, jitter: 0 },
    });
    transport.subscribe('error', (error) => errors.push(error));

    await transport.start();
    harness.emit('open');
    harness.emit('close');
    expect(transport.status.state).toBe('reconnecting');
    expect(errors.map((error) => error.message)).toContain('socket closed');

    await vi.advanceTimersByTimeAsync(20);
    expect(transport.status.attempts).toBe(1);
    transport.stop();
    expect(harness.isClosed()).toBe(true);
    vi.useRealTimers();
  });
});

describe('SseTransport', () => {
  it('parses named SSE events into snapshots', async () => {
    const listeners = new Map<string, Array<(event: { data?: string }) => void>>();
    const Source = class {
      constructor(private readonly url: string) {
        this.url = url;
      }
      close(): void {}
      addEventListener(type: string, listener: (event: { data?: string }) => void): void {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      }
    };

    const store = new WidgetStore();
    const transport = new SseTransport({
      url: 'https://example.test/events',
      eventSourceFactory: Source as never,
    });
    transport.subscribe('snapshot', (snapshot) => store.update(snapshot));
    await transport.start();

    for (const listener of listeners.get('message') ?? []) {
      listener({ data: JSON.stringify(createMockSnapshot({ elapsedSeconds: 9 })) });
    }

    expect(transport.status.received).toBe(1);
    expect(store.snapshot).not.toBeNull();
    transport.stop();
  });
});
