import { describe, expect, it, vi } from 'vitest';
import { normalizeLogEntry, normalizeLogSnapshot, toEpochMs } from '../src/log-normalize';
import { LogStore } from '../src/log-store';
import { createMockLogSnapshot } from '../src/log-mock';
import { toLogLevel } from '../src/log-types';

describe('toLogLevel', () => {
  it('normalises free-form severities', () => {
    expect(toLogLevel('WARNING')).toBe('warn');
    expect(toLogLevel('err')).toBe('error');
    expect(toLogLevel('CRITICAL')).toBe('fatal');
    expect(toLogLevel('panic')).toBe('fatal');
    expect(toLogLevel('DBG')).toBe('debug');
    expect(toLogLevel('notice')).toBe('info');
    expect(toLogLevel(undefined)).toBe('info');
  });
});

describe('toEpochMs', () => {
  it('handles s, ms, µs, ns and ISO strings', () => {
    expect(toEpochMs(1_700_000_000, 0)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000, 0)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000_000, 0)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000_000_000, 0)).toBe(1_700_000_000_000);
    expect(toEpochMs('2026-11-06T10:00:00.000Z', 0)).toBe(Date.parse('2026-11-06T10:00:00.000Z'));
    expect(toEpochMs('not-a-date', 5)).toBe(5);
  });
});

describe('normalizeLogSnapshot', () => {
  it('accepts an array of lines', () => {
    const snapshot = normalizeLogSnapshot([
      { level: 'info', msg: 'hello', service: 'api' },
      { severity: 'ERROR', message: 'boom', app: 'worker' },
    ]);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.entries).toHaveLength(2);
    expect(snapshot!.entries[0]).toMatchObject({ level: 'info', message: 'hello', service: 'api' });
    expect(snapshot!.entries[1]).toMatchObject({ level: 'error', message: 'boom', service: 'worker' });
  });

  it('accepts wrapped payloads and common list keys', () => {
    const wrapped = normalizeLogSnapshot({ data: { lines: [{ message: 'from data.lines' }] } });
    expect(wrapped!.entries[0]!.message).toBe('from data.lines');

    const logs = normalizeLogSnapshot({ logs: [{ msg: 'from logs' }] });
    expect(logs!.entries[0]!.message).toBe('from logs');
  });

  it('accepts a single streamed line', () => {
    const snapshot = normalizeLogSnapshot({ type: 'log', level: 'warn', message: 'single frame', service: 'edge' });
    expect(snapshot!.entries).toHaveLength(1);
    expect(snapshot!.entries[0]).toMatchObject({ level: 'warn', service: 'edge' });
  });

  it('treats an explicitly empty batch as a valid, empty snapshot', () => {
    const snapshot = normalizeLogSnapshot({ entries: [] });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.entries).toEqual([]);
  });

  it('keeps unusual payloads out of the pipeline', () => {
    expect(normalizeLogSnapshot(null)).toBeNull();
    expect(normalizeLogSnapshot(42)).toBeNull();
    expect(normalizeLogSnapshot({ type: 'subscribed', stream: 'logs' })).toBeNull();
    expect(normalizeLogSnapshot([{ level: 'info' }])).toBeNull();
  });

  it('extracts attributes from explicit and stray fields', () => {
    const entry = normalizeLogEntry({
      message: 'query done',
      attributes: { rows: 42 },
      tenant: 'acme',
      eager: true,
    })!;
    expect(entry.attributes).toMatchObject({ rows: 42, tenant: 'acme', eager: true });
    // Reserved keys must not leak into attributes.
    expect(entry.attributes).not.toHaveProperty('message');
  });

  it('parses host, pid, trace id and keep ids unique', () => {
    const entry = normalizeLogEntry({ id: 'abc', message: 'x', host: 'edge-1', pid: '4321', trace_id: 'tr-1' })!;
    expect(entry.host).toBe('edge-1');
    expect(entry.pid).toBe(4321);
    expect(entry.traceId).toBe('tr-1');
    expect(entry.id).toBe('abc-0');
    expect(normalizeLogEntry({ id: 'abc', message: 'x' }, 3)!.id).toBe('abc-3');
  });
});
