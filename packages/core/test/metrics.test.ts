import { describe, expect, it } from 'vitest';
import { classify, computeHealth, defaultThresholds, mergeThresholds, worstStatus } from '../src/thresholds';
import { compactNumber, formatBytes, formatPercent, formatRate, formatUptime, niceCeil } from '../src/format';
import { createMockSnapshot } from '../src/mock';

describe('thresholds', () => {
  it('classifies values against the default rules', () => {
    expect(classify(10, defaultThresholds.cpu)).toBe('ok');
    expect(classify(75, defaultThresholds.cpu)).toBe('warning');
    expect(classify(91, defaultThresholds.cpu)).toBe('critical');
  });

  it('treats non finite values as unknown', () => {
    expect(classify(Number.NaN, defaultThresholds.cpu)).toBe('unknown');
  });

  it('picks the worst status in a list', () => {
    expect(worstStatus(['ok', 'warning', 'ok'])).toBe('warning');
    expect(worstStatus(['ok', 'critical', 'warning'])).toBe('critical');
    expect(worstStatus([])).toBe('unknown');
  });

  it('merges partial overrides per metric', () => {
    const merged = mergeThresholds({ cpu: { warning: 50, critical: 60 } });
    expect(merged.cpu).toEqual({ warning: 50, critical: 60 });
    expect(merged.memory).toEqual(defaultThresholds.memory);
  });
});

describe('health score', () => {
  it('returns a perfect score for an idle host', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 1 });
    const idle = {
      ...snapshot,
      cpu: { ...snapshot.cpu, usage: 4, load: [0.1, 0.1, 0.1] as [number, number, number] },
      memory: { ...snapshot.memory, usage: 20, swapUsed: 0 },
      disk: { ...snapshot.disk, usage: 30 },
      alerts: [],
    };
    const health = computeHealth(idle);
    expect(health.score).toBe(100);
    expect(health.grade).toBe('A+');
    expect(health.label).toBe('healthy');
  });

  it('degrades the score as pressure and alerts accumulate', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 1 });
    const stressed = {
      ...snapshot,
      cpu: { ...snapshot.cpu, usage: 97, load: [40, 40, 40] as [number, number, number] },
      memory: { ...snapshot.memory, usage: 96, swapTotal: 1e9, swapUsed: 9e8 },
      disk: { ...snapshot.disk, usage: 95 },
      alerts: [{ id: 'a', title: 'crit', severity: 'critical' as const }],
    };
    const health = computeHealth(stressed);
    expect(health.score).toBeLessThan(40);
    expect(health.label).toBe('critical');
  });

  it('is clamped to the 0..100 range', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 3 });
    const health = computeHealth(snapshot);
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });
});

describe('formatting', () => {
  it('scales bytes with binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(1024 ** 3 * 2.25)).toBe('2.3 GiB');
  });

  it('supports SI units and rates', () => {
    expect(formatBytes(1500, { si: true })).toBe('1.5 kB');
    expect(formatRate(1536)).toBe('1.5 KiB/s');
  });

  it('formats percentages with clamping', () => {
    expect(formatPercent(92.44)).toBe('92.4%');
    expect(formatPercent(92.44, 0)).toBe('92%');
    expect(formatPercent(140, 0)).toBe('100%');
  });

  it('formats uptime in short and long form', () => {
    expect(formatUptime(3672)).toBe('1h 1m');
    expect(formatUptime(90000)).toBe('1d 1h');
    expect(formatUptime(30)).toBe('<1m');
    expect(formatUptime(3600, 'long')).toBe('1 hour');
  });

  it('compacts large numbers', () => {
    expect(compactNumber(1240)).toBe('1.2k');
    expect(compactNumber(2_400_000)).toBe('2.4M');
  });

  it('rounds to nice axis maxima', () => {
    expect(niceCeil(87)).toBe(100);
    expect(niceCeil(12)).toBe(20);
    expect(niceCeil(0)).toBe(1);
  });

  it('handles non finite input gracefully', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
