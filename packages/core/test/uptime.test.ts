import { describe, expect, it } from 'vitest';
import {
  UptimeStore,
  averageUptime,
  computeErrorBudgetUsed,
  createMockUptimeSnapshot,
  normalizeDays,
  normalizeUptimeSnapshot,
  toIncidentSeverity,
  toIncidentState,
  toServiceState,
  utcDayStart,
  type UptimeDay,
} from '@widgets/core';

describe('uptime normalisation', () => {
  it('round-trips a canonical snapshot', () => {
    const original = createMockUptimeSnapshot({
      size: 5,
      windowDays: 30,
      incident: true,
      now: Date.UTC(2026, 10, 6),
    });
    const normalized = normalizeUptimeSnapshot(original);
    expect(normalized).not.toBeNull();
    expect(normalized!.services).toHaveLength(5);
    expect(normalized!.windowDays).toBe(30);
    const first = original.services[0]!;
    const round = normalized!.services.find((service) => service.id === first.id)!;
    expect(round.uptime).toBeCloseTo(first.uptime, 3);
    expect(round.sloTarget).toBe(first.sloTarget);
    expect(round.state).toBe(first.state);
    expect(round.days).toHaveLength(30);
    expect(round.days[0]!.day).toBe(first.days[0]!.day);
  });

  it('maps a Statuspage style payload with code history', () => {
    const snapshot = normalizeUptimeSnapshot({
      components: [
        { id: 'abc', name: 'API', group: { name: 'edge' }, status: 'Partial Outage', history: 'OOODMO' },
        { id: 'def', name: 'DB', status: 'All Systems Operational', history: [99.9, 100, 98.5] },
      ],
      incidents: [
        {
          id: 'i1',
          name: 'Elevated errors',
          impact: 'critical',
          status: 'resolved',
          created_at: '2026-10-20T10:00:00.000Z',
          resolved_at: '2026-10-20T11:30:00.000Z',
          components: [{ id: 'abc', name: 'API' }],
          incident_updates: [
            { status: 'investigating', body: 'Looking into it', created_at: '2026-10-20T10:05:00.000Z' },
            { status: 'resolved', body: 'Fixed', created_at: '2026-10-20T11:30:00.000Z' },
          ],
        },
      ],
      status: { indicator: 'partial_outage' },
    });

    expect(snapshot).not.toBeNull();
    const api = snapshot!.services[0]!;
    expect(api.name).toBe('API');
    expect(api.group).toBe('edge');
    expect(api.state).toBe('partial_outage');
    expect(api.days).toHaveLength(6);
    expect(api.days[3]!.state).toBe('degraded');
    expect(api.days[4]!.state).toBe('major_outage'); // `M`
    expect(normalizeDays({ history: 'OS' })[1]!.state).toBe('maintenance');

    const db = snapshot!.services[1]!;
    expect(db.days).toHaveLength(3);
    expect(db.days[0]!.uptime).toBeCloseTo(99.9, 3);

    const incident = snapshot!.incidents[0]!;
    expect(incident.title).toBe('Elevated errors');
    expect(incident.severity).toBe('critical');
    expect(incident.state).toBe('resolved');
    expect(incident.services).toEqual(['abc']);
    expect(incident.updates).toHaveLength(2);
    expect(incident.updates[0]!.message).toBe('Looking into it');
    expect(incident.resolvedAt).toBe(Date.parse('2026-10-20T11:30:00.000Z'));
  });

  it('accepts wrapped payloads and flat aliases', () => {
    const wrapped = normalizeUptimeSnapshot({ data: { services: [{ name: 'a', uptime: 99.5, slo: 99.9 }] } });
    expect(wrapped!.services[0]!.name).toBe('a');
    expect(wrapped!.services[0]!.uptime).toBeCloseTo(99.5, 3);
    expect(wrapped!.services[0]!.sloTarget).toBe(99.9);
    expect(wrapped!.services[0]!.errorBudgetUsed).toBeGreaterThan(50);
  });

  it('rejects unusable payloads', () => {
    expect(normalizeUptimeSnapshot(null)).toBeNull();
    expect(normalizeUptimeSnapshot('nope')).toBeNull();
    expect(normalizeUptimeSnapshot({ services: [] })).toEqual({
      timestamp: expect.any(Number),
      services: [],
      incidents: [],
      windowDays: 90,
      mode: 'replace',
    });
    expect(normalizeUptimeSnapshot({ services: [{ uptime: 99 }] })).toBeNull();
  });
});

describe('uptime helpers', () => {
  it('normalises days in every accepted shape', () => {
    const numeric = normalizeDays({ history: [100, 99.5, 97] });
    expect(numeric).toHaveLength(3);
    expect(numeric[1]!.uptime).toBeCloseTo(99.5, 3);
    expect(numeric[2]!.state).toBe('partial_outage');

    const objects = normalizeDays({
      days: [
        { day: '2026-10-01', state: 'degraded', uptime: 99.1, incidents: ['i1'] },
        { day: 1_790_000_000_000, state: 'operational', uptime: 100, latencyMs: 120 },
      ],
    });
    expect(objects).toHaveLength(2);
    // Entries are sorted oldest first, whatever the input order.
    expect(objects.map((day) => day.day)).toEqual([1_790_000_000_000, Date.parse('2026-10-01')]);
    const october = objects.find((day) => day.day === Date.parse('2026-10-01'))!;
    expect(october.incidents).toEqual(['i1']);
    expect(october.state).toBe('degraded');
    expect(objects[0]!.latencyMs).toBe(120);
  });

  it('classifies states, severities and lifecycles', () => {
    expect(toServiceState('Major Outage')).toBe('major_outage');
    expect(toServiceState('degraded performance')).toBe('degraded');
    expect(toServiceState('Scheduled Maintenance')).toBe('maintenance');
    expect(toServiceState(undefined)).toBe('unknown');
    expect(toServiceState({})).toBe('unknown');
    expect(toIncidentSeverity('Critical')).toBe('critical');
    expect(toIncidentSeverity('sev2')).toBe('major');
    expect(toIncidentSeverity('minor')).toBe('minor');
    expect(toIncidentState('Monitoring')).toBe('monitoring');
    expect(toIncidentState('Resolved')).toBe('resolved');
  });

  it('computes availability helpers', () => {
    const days: UptimeDay[] = [
      { day: 0, state: 'operational', uptime: 100, incidents: [] },
      { day: 1, state: 'degraded', uptime: 98, incidents: [] },
    ];
    expect(averageUptime(days)).toBe(99);
    expect(averageUptime([])).toBe(100);
    expect(computeErrorBudgetUsed(100, 99.9)).toBe(0);
    expect(computeErrorBudgetUsed(99.9, 99.9)).toBeCloseTo(100, 1);
    expect(computeErrorBudgetUsed(98, 99.9)).toBe(100);
    expect(utcDayStart(Date.UTC(2026, 10, 6, 23, 59))).toBe(Date.UTC(2026, 10, 6));
  });
});
