import { describe, expect, it, vi } from 'vitest';
import { WidgetStore } from '../src/store';
import { normalizeSnapshot } from '../src/normalize';
import { createMockSnapshot } from '../src/mock';
import { MockTransport } from '../src/transport/mock';
import { HttpTransport } from '../src/transport/http';
import type { WidgetSnapshot } from '../src/types';

describe('normalizeSnapshot', () => {
  it('accepts a canonical snapshot untouched', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 5 });
    const normalized = normalizeSnapshot(snapshot);
    expect(normalized).not.toBeNull();
    expect(normalized!.host.name).toBe(snapshot.host.name);
    expect(normalized!.cpu.perCore.length).toBe(snapshot.cpu.perCore.length);
    expect(normalized!.disk.partitions).toHaveLength(3);
  });

  it('unwraps { data: ... } envelopes', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 5 });
    const normalized = normalizeSnapshot({ data: snapshot });
    expect(normalized!.host.name).toBe(snapshot.host.name);
  });

  it('maps a flat metric payload with snake_case aliases', () => {
    const normalized = normalizeSnapshot({
      hostname: 'edge-07',
      cpu_usage: '42.5',
      cpu_cores: 8,
      memory_total: 16 * 1024 ** 3,
      memory_used: 8 * 1024 ** 3,
      disk_usage: 55,
      network: { rx_bps: 1024, tx_bps: 512, latency: 42 },
      processes: [{ pid: 7, name: 'nginx', cpu: 12.5, rss: 1024 ** 3 }],
    });

    expect(normalized).not.toBeNull();
    expect(normalized!.cpu.usage).toBe(42.5);
    expect(normalized!.cpu.perCore).toHaveLength(8);
    expect(normalized!.memory.usage).toBeCloseTo(50, 1);
    expect(normalized!.network.rxBytesPerSec).toBe(1024);
    expect(normalized!.processes[0]!.name).toBe('nginx');
    expect(normalized!.processes[0]!.memoryPercent).toBeCloseTo(6.3, 1);
  });

  it('derives alerts when the payload has none', () => {
    const normalized = normalizeSnapshot({ cpu_usage: 97, memory_usage: 95, disk_usage: 92 });
    expect(normalized!.alerts.map((a) => a.severity)).toContain('critical');
  });

  it('returns null for unusable payloads', () => {
    expect(normalizeSnapshot(null)).toBeNull();
    expect(normalizeSnapshot('nope')).toBeNull();
    expect(normalizeSnapshot(42)).toBeNull();
  });

  it('rejects transport control frames', () => {
    expect(normalizeSnapshot({ type: 'subscribed', stream: 'server-metrics' })).toBeNull();
    expect(normalizeSnapshot({ type: 'ping', t: 123 })).toBeNull();
    expect(normalizeSnapshot({ type: 'presence', id: 'abc' })).toBeNull();
    expect(normalizeSnapshot({ data: { type: 'ack', code: 200 } })).toBeNull();
    expect(normalizeSnapshot({})).toBeNull();
  });

  it('clamps percentages into range', () => {
    const normalized = normalizeSnapshot({ cpu: { usage: 180 }, memory: { usage: -12 } });
    expect(normalized!.cpu.usage).toBe(100);
    expect(normalized!.memory.usage).toBe(0);
  });

  it('keeps an explicit alerts array', () => {
    const normalized = normalizeSnapshot({
      cpu: { usage: 10 },
      alerts: [{ id: 'x', title: 'Certificate expiring', severity: 'warning', metric: 'tls' }],
    });
    expect(normalized!.alerts[0]).toMatchObject({ id: 'x', severity: 'warning', metric: 'tls' });
  });
});
