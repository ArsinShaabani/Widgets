/**
 * Uptime / SLA contracts for the uptime-timeline widget.
 *
 * Kept in `core` so hosts, the mock server and every renderer agree on the shape.
 */

/** Operational state of a service, ordered from healthy to broken. */
export type ServiceState =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance'
  | 'unknown';

export const SERVICE_STATES: readonly ServiceState[] = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'unknown',
];

/** Severity used by incidents and by the timeline heatmap. */
export type IncidentSeverity = 'minor' | 'major' | 'critical' | 'maintenance';

export type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved';

/** One day of history, used to paint the heatmap. */
export interface UptimeDay {
  /** Day start, epoch ms (UTC midnight). */
  day: number;
  /** Worst state seen during that day. */
  state: ServiceState;
  /** Availability for the day, 0..100. */
  uptime: number;
  /** Incidents that touched this day. */
  incidents: string[];
  /** Mean response time for the day, in ms. */
  latencyMs?: number;
}

export interface UptimeService {
  id: string;
  name: string;
  /** Owning team / product group. */
  group?: string;
  /** Current state. */
  state: ServiceState;
  /** Availability over the monitored window, 0..100. */
  uptime: number;
  /** SLO target for the window, 0..100. */
  sloTarget: number;
  /** Error budget consumed, 0..100 (100 = budget exhausted). */
  errorBudgetUsed: number;
  /** Daily history, oldest first. */
  days: UptimeDay[];
  /** Response time percentiles in ms. */
  latency?: { p50?: number; p95?: number; p99?: number };
  /** Id of the incident currently affecting the service. */
  activeIncidentId?: string;
}

export interface UptimeIncidentUpdate {
  at: number;
  state: IncidentState;
  message: string;
}

export interface UptimeIncident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  state: IncidentState;
  startedAt: number;
  /** Epoch ms when resolved; `undefined` means the incident is still open. */
  resolvedAt?: number;
  /** Affected service ids. */
  services: string[];
  updates: UptimeIncidentUpdate[];
  /** Impacted users ratio 0..100, when reported. */
  impact?: number;
}

export interface UptimeSnapshot {
  timestamp: number;
  services: UptimeService[];
  incidents: UptimeIncident[];
  /** Window covered by each service's `days` array (default 90). */
  windowDays?: number;
  /** `'replace'` treats the payload as the whole fleet, `'upsert'` merges. */
  mode?: 'upsert' | 'replace';
}

export interface UptimeFilter {
  /** States to keep; empty means "all". */
  states: ServiceState[];
  /** Groups to keep; empty means "all". */
  groups: string[];
  /** Free-text query against name, group and incident titles. */
  query: string;
  /** Only show services with an open incident or a breached SLO. */
  attentionOnly?: boolean;
}

export const emptyUptimeFilter: UptimeFilter = { states: [], groups: [], query: '' };

export interface UptimeStats {
  total: number;
  byState: Record<ServiceState, number>;
  byGroup: Array<{ group: string; count: number; impacted: number }>;
  /** Services with an open incident or a degraded state. */
  impacted: number;
  /** Services below their SLO. */
  belowSlo: number;
  /** Availability across all services (days weighted). */
  overallUptime: number;
  /** Worst current state in the fleet. */
  worstState: ServiceState;
  openIncidents: number;
  /** Incidents resolved inside the window. */
  resolvedIncidents: number;
  /** Mean time to resolve, in ms (resolved incidents only). */
  mttr: number;
  /** Mean time between failures, in ms. */
  mtbf: number;
  /** Days covered by the history. */
  windowDays: number;
}

/** Severity ranking (higher = worse) used for rollups and sorting. */
export const STATE_RANK: Record<ServiceState, number> = {
  unknown: -1,
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

/** Maps a state onto the incident severity it implies. */
export function stateToSeverity(state: ServiceState): IncidentSeverity {
  if (state === 'major_outage') return 'critical';
  if (state === 'partial_outage') return 'major';
  if (state === 'maintenance') return 'maintenance';
  return 'minor';
}

/** Normalises free-form status strings (`All Systems Operational`, `Partial Outage`…). */
export function toServiceState(value: unknown): ServiceState {
  if (typeof value !== 'string' && typeof value !== 'number') return 'unknown';
  const text = String(value).trim().toLowerCase();
  if (text.length === 0) return 'unknown';
  if (text.includes('maintenance') || text.includes('scheduled')) return 'maintenance';
  if (text.includes('major') || text.includes('critical')) return 'major_outage';
  if (text.includes('partial') || text.includes('outage')) return 'partial_outage';
  if (text.includes('degrad') || text.includes('warn') || text.includes('slow')) return 'degraded';
  if (text.includes('operational') || text.includes('healthy') || text === 'ok' || text === 'up') {
    return 'operational';
  }
  if (text.includes('unknown') || text === 'none') return 'unknown';
  return 'unknown';
}

/** Normalises incident severities. */
export function toIncidentSeverity(value: unknown): IncidentSeverity {
  const text = String(value ?? '').trim().toLowerCase();
  if (text.startsWith('crit') || text === 'high' || text === 'sev1' || text === 'sev0') return 'critical';
  if (text.startsWith('maint')) return 'maintenance';
  if (text.startsWith('major') || text === 'medium' || text === 'sev2') return 'major';
  return 'minor';
}

/** Normalises the incident lifecycle. */
export function toIncidentState(value: unknown): IncidentState {
  const text = String(value ?? '').trim().toLowerCase();
  if (text.startsWith('invest')) return 'investigating';
  if (text.startsWith('ident')) return 'identified';
  if (text.startsWith('monitor')) return 'monitoring';
  if (text.startsWith('resol') || text.startsWith('closed') || text.startsWith('complete')) return 'resolved';
  return 'investigating';
}

/** Worst of two states (the one with the higher rank). */
export function worstState(a: ServiceState, b: ServiceState): ServiceState {
  return STATE_RANK[b] > STATE_RANK[a] ? b : a;
}

