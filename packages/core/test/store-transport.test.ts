import { describe, expect, it, vi } from 'vitest';
import { WidgetStore } from '../src/store';
import { createMockSnapshot } from '../src/mock';
import { MockTransport } from '../src/transport/mock';
import { HttpTransport } from '../src/transport/http';
import type { WidgetSnapshot } from '../src/types';

describe('WidgetStore', () => {
  it('keeps history bounded and reports the sample count', () => {
    const store = new WidgetStore({ historySize: 3 });
    for (let i = 1; i <= 6; i += 1) {
      store.update(createMockSnapshot({ elapsedSeconds: i * 10 }));
    }
    expect(store.series('cpu')).toHaveLength(3);
    expect(store.series('cpu', 2)).toHaveLength(2);
    expect(store.historySnapshot().memory).toHaveLength(3);
  });

  it('emits update and history events', () => {
    const store = new WidgetStore();
    const updates: WidgetSnapshot[] = [];
    const historyCounts: number[] = [];
    store.on('update', ({ current }) => updates.push(current));
    store.on('history', (history) => historyCounts.push(history.cpu.length));

    store.update(createMockSnapshot({ elapsedSeconds: 1 }));
    store.update(createMockSnapshot({ elapsedSeconds: 2 }));

    expect(updates).toHaveLength(2);
    expect(historyCounts).toEqual([1, 2]);
  });

  it('emits an alert when a metric crosses a threshold', () => {
    const store = new WidgetStore({ thresholds: { cpu: { warning: 50, critical: 80 } } });
    const alertSpy = vi.fn();
    store.on('alert', alertSpy);

    const healthy = createMockSnapshot({ elapsedSeconds: 1 });
    store.update({ ...healthy, cpu: { ...healthy.cpu, usage: 10 } });
    store.update({ ...healthy, cpu: { ...healthy.cpu, usage: 60 } });
    store.update({ ...healthy, cpu: { ...healthy.cpu, usage: 85 } });

    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(alertSpy.mock.calls[0]![0]).toMatchObject({ metric: 'cpu', from: 'ok', to: 'warning' });
    expect(alertSpy.mock.calls[1]![0]).toMatchObject({ metric: 'cpu', from: 'warning', to: 'critical' });
  });

  it('clears buffered state', () => {
    const store = new WidgetStore();
    store.update(createMockSnapshot({ elapsedSeconds: 1 }));
    store.clear();
    expect(store.snapshot).toBeNull();
    expect(store.series('cpu')).toHaveLength(0);
  });
});

describe('MockTransport', () => {
  it('emits snapshots into the store when started', async () => {
    const store = new WidgetStore();
    const transport = new MockTransport({ intervalMs: 0, elapsedSeconds: 0 });
    transport.subscribe('snapshot', (snapshot) => store.update(snapshot));

    await transport.start();
    transport.pushOne();

    expect(transport.status.state).toBe('live');
    expect(transport.status.received).toBe(2);
    expect(store.series('cpu')).toHaveLength(2);
    transport.stop();
    expect(transport.status.state).toBe('closed');
  });
});

describe('HttpTransport', () => {
  it('ingests a fetch response and keeps polling', async () => {
    vi.useFakeTimers();
    const snapshot = createMockSnapshot({ elapsedSeconds: 12 });
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: snapshot }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const received: WidgetSnapshot[] = [];
    const transport = new HttpTransport({ url: 'https://example.test/metrics', intervalMs: 1000, fetchImpl });
    transport.subscribe('snapshot', (s) => received.push(s));

    await transport.start();
    expect(received).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toHaveLength(2);

    transport.stop();
    expect(transport.status.state).toBe('closed');
    vi.useRealTimers();
  });

  it('backs off and reports an error when the endpoint fails', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const errors: Error[] = [];
    const transport = new HttpTransport({ url: 'https://example.test/metrics', intervalMs: 100, fetchImpl });
    transport.subscribe('error', (error) => errors.push(error));

    await transport.start();
    expect(errors).toHaveLength(1);
    expect(transport.status.state).toBe('reconnecting');
    expect(transport.status.attempts).toBe(1);

    transport.stop();
    vi.useRealTimers();
  });
});
