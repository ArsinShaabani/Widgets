import { computeErrorBudgetUsed, utcDayStart } from './uptime-normalize';
import {
  worstState,
  type IncidentSeverity,
  type ServiceState,
  type UptimeDay,
  type UptimeIncident,
  type UptimeService,
  type UptimeSnapshot,
} from './uptime-types';

/**
 * Deterministic synthetic status page.
 *
 * Produces a handful of services across product groups with a 90 day history
 * (including a few bad days), an optional open incident and a set of resolved
 * ones — enough to exercise the heatmap, the SLA rollups and the incident timeline.
 */
export interface MockUptimeOptions {
  seed?: number;
  elapsedSeconds?: number;
  /** Services to generate (default 8). */
  size?: number;
  /** History window in days (default 90). */
  windowDays?: number;
  /** Force one service into a major outage with an open incident. */
  incident?: boolean;
  /** Anchor instant for the history (epoch ms, defaults to now). */
  now?: number;
}

const SERVICES: ReadonlyArray<{ name: string; group: string; slo: number }> = [
  { name: 'api-gateway', group: 'edge', slo: 99.95 },
  { name: 'cdn-edge', group: 'edge', slo: 99.9 },
  { name: 'auth-service', group: 'platform', slo: 99.95 },
  { name: 'container-registry', group: 'platform', slo: 99.5 },
  { name: 'postgres-primary', group: 'data', slo: 99.99 },
  { name: 'kafka-brokers', group: 'data', slo: 99.9 },
  { name: 'billing-api', group: 'billing', slo: 99.9 },
  { name: 'invoice-worker', group: 'billing', slo: 99.5 },
];

const INCIDENT_TITLES: ReadonlyArray<{ title: string; severity: IncidentSeverity }> = [
  { title: 'Elevated 5xx on the edge fleet', severity: 'critical' },
  { title: 'Database failover took longer than expected', severity: 'major' },
  { title: 'Slow queries after index rebuild', severity: 'minor' },
  { title: 'Scheduled certificate rotation', severity: 'maintenance' },
  { title: 'Partial ingestion lag on kafka', severity: 'major' },
];

const DAY_MS = 86_400_000;

/** Small, fast, deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean availability across the days. */
function average(days: readonly UptimeDay[]): number {
  if (days.length === 0) return 100;
  return Number((days.reduce((sum, day) => sum + day.uptime, 0) / days.length).toFixed(4));
}

/** Worst state across the fleet (exported for tests). */
export function mockWorstState(snapshot: UptimeSnapshot): ServiceState {
  return snapshot.services.reduce<ServiceState>((worst, service) => worstState(worst, service.state), 'unknown');
}

/** Builds one synthetic status-page snapshot. */
export function createMockUptimeSnapshot(options: MockUptimeOptions = {}): UptimeSnapshot {
  const { seed = 5, size = 8, windowDays = 90, incident = false } = options;
  const now = options.now ?? Date.now();
  const today = utcDayStart(now);
  const random = mulberry32(seed + Math.floor(now / DAY_MS));
  const count = Math.max(1, Math.min(size, SERVICES.length));

  const incidents: UptimeIncident[] = [];
  const services: UptimeService[] = [];

  for (let index = 0; index < count; index += 1) {
    const base = SERVICES[index % SERVICES.length]!;
    const serviceId = `${base.group}/${base.name}`;
    const days: UptimeDay[] = [];

    // 2–4 bad days scattered through the window, so the heatmap has texture.
    const badDayOffsets = new Set<number>();
    const badCount = 2 + Math.floor(random() * 3);
    for (let bad = 0; bad < badCount; bad += 1) {
      badDayOffsets.add(Math.floor(random() * (windowDays - 2)) + 1);
    }
    const badState: ServiceState =
      index % 3 === 0 ? 'major_outage' : index % 3 === 1 ? 'partial_outage' : 'degraded';

    for (let dayIndex = 0; dayIndex < windowDays; dayIndex += 1) {
      const offsetFromToday = windowDays - 1 - dayIndex;
      const isBad = badDayOffsets.has(offsetFromToday);
      const state: ServiceState = isBad ? badState : 'operational';
      const uptime = isBad ? (badState === 'major_outage' ? 92 + random() * 6 : 97 + random() * 2.5) : 100;
      days.push({
        day: today - offsetFromToday * DAY_MS,
        state,
        uptime: Number(uptime.toFixed(3)),
        incidents: [],
        latencyMs: Math.round(70 + random() * 180),
      });
    }

    const isActiveOutage = incident && index === 0;
    const isDegraded = incident ? index === 1 || index === 3 : index === 1;

    if (isActiveOutage) {
      const incidentId = `inc-${base.name}-open`;
      const startedAt = now - 1000 * 60 * 47;
      incidents.push({
        id: incidentId,
        title: 'Elevated 5xx on the edge fleet',
        severity: 'critical',
        state: 'monitoring',
        startedAt,
        services: [serviceId],
        impact: 12,
        updates: [
          { at: startedAt, state: 'investigating', message: 'Error rate above threshold, investigating.' },
          { at: startedAt + 1000 * 60 * 18, state: 'identified', message: 'Root cause: bad canary release.' },
          { at: now - 1000 * 60 * 6, state: 'monitoring', message: 'Traffic drained from the canary.' },
        ],
      });
      const last = days[days.length - 1]!;
      last.state = 'major_outage';
      last.uptime = 71.4;
      last.incidents = [incidentId];
      const uptime = average(days);
      services.push({
        id: serviceId,
        name: base.name,
        group: base.group,
        state: 'major_outage',
        uptime,
        sloTarget: base.slo,
        errorBudgetUsed: computeErrorBudgetUsed(uptime, base.slo),
        days,
        latency: { p50: 118, p95: 640, p99: 1820 },
        activeIncidentId: incidentId,
      });
      continue;
    }

    // A resolved incident a few weeks back, with an update trail.
    const resolvedOffset = 12 + Math.floor(random() * 30);
    const resolvedAt = today - resolvedOffset * DAY_MS + 1000 * 60 * 60 * 4;
    const startedAt = resolvedAt - 1000 * 60 * (35 + Math.floor(random() * 90));
    const template = INCIDENT_TITLES[index % INCIDENT_TITLES.length]!;
    incidents.push({
      id: `inc-${base.name}-resolved`,
      title: template.title,
      severity: template.severity,
      state: 'resolved',
      startedAt,
      resolvedAt,
      services: [serviceId],
      impact: template.severity === 'critical' ? 8 : 3,
      updates: [
        { at: startedAt, state: 'investigating', message: 'Alert fired, on-call engaged.' },
        { at: resolvedAt - 1000 * 60 * 12, state: 'identified', message: 'Mitigation applied.' },
        { at: resolvedAt, state: 'resolved', message: 'Recovered, monitoring for 30 minutes.' },
      ],
    });

    const state: ServiceState = isDegraded ? 'degraded' : 'operational';
    if (isDegraded) {
      const last = days[days.length - 1]!;
      last.state = 'degraded';
      last.uptime = 98.9;
    }
    const uptime = average(days);
    services.push({
      id: serviceId,
      name: base.name,
      group: base.group,
      state,
      uptime,
      sloTarget: base.slo,
      errorBudgetUsed: computeErrorBudgetUsed(uptime, base.slo),
      days,
      latency: { p50: 64 + Math.round(random() * 40), p95: 220 + Math.round(random() * 160) },
    });
  }

  return { timestamp: now, services, incidents, windowDays, mode: 'replace' };
}

