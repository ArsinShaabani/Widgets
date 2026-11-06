import {
  toIncidentSeverity,
  toIncidentState,
  toServiceState,
  worstState,
  type UptimeDay,
  type UptimeIncident,
  type UptimeIncidentUpdate,
  type UptimeService,
  type UptimeSnapshot,
} from './uptime-types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const num = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace('%', ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' ? String(value) : fallback;

type Rec = Record<string, unknown>;

const DAY_MS = 86_400_000;

/** Statuspage history codes: `O` operational, `D` degraded, `P` partial, `M` major, `S` maintenance. */
const HISTORY_CODES: Record<string, UptimeService['state']> = {
  o: 'operational',
  d: 'degraded',
  p: 'partial_outage',
  m: 'major_outage',
  s: 'maintenance',
  n: 'unknown',
  u: 'unknown',
};

/**
 * Maps an arbitrary uptime payload into a `UptimeSnapshot`.
 *
 * Accepted shapes:
 *   - canonical `{ services, incidents }`
 *   - flat `{ services: [{ name, uptime, slo, status, history }] }`
 *   - Statuspage style `{ components, incidents, status }` with `history` code strings
 *   - `{ data: … }` / `{ payload: … }` wrappers
 */
export function normalizeUptimeSnapshot(payload: unknown): UptimeSnapshot | null {
  const root = unwrap(payload);
  if (!isRecord(root)) return null;

  const serviceList =
    firstArray(root, ['services', 'components', 'monitors']) ??
    (Array.isArray(root.items) ? (root.items as unknown[]) : null);

  if (!serviceList) return null;
  const services = serviceList.map((entry) => normalizeService(entry)).filter(isService);
  if (services.length === 0 && serviceList.length > 0) return null;

  const incidentList = firstArray(root, ['incidents', 'events', 'outages']) ?? [];
  const incidents = incidentList.map((entry, index) => normalizeIncident(entry, index)).filter(isIncident);
  const windowDays = num(
    root.windowDays ?? root.window_days,
    services.reduce((max, service) => Math.max(max, service.days.length), 0) || 90,
  );

  return {
    timestamp: num(root.timestamp ?? root.ts, Date.now()),
    services,
    incidents,
    windowDays,
    mode: root.mode === 'upsert' ? 'upsert' : 'replace',
  };
}

/** Normalises one service/component; returns `null` when there is no usable name. */
export function normalizeService(raw: unknown): UptimeService | null {
  if (!isRecord(raw)) return null;

  const name = str(pick([raw], ['name', 'service', 'serviceName', 'component', 'monitor'], ''), '');
  if (name.length === 0) return null;

  const id = str(pick([raw], ['id', 'uid', 'slug', 'key'], name), name);
  const groupValue = raw.group;
  const groupSource = isRecord(groupValue) ? groupValue.name : groupValue;
  const group = str(groupSource ?? pick([raw], ['team', 'product', 'componentGroup'], ''), '');

  const days = normalizeDays(raw);
  const state = toServiceState(pick([raw], ['state', 'status', 'currentStatus', 'indicator'], 'unknown'));
  const uptime = num(
    pick([raw], ['uptime', 'availability', 'sla', 'uptimePercent', 'availabilityPercent'], Number.NaN),
    Number.NaN,
  );
  const computedUptime = Number.isFinite(uptime) ? uptime : averageUptime(days);
  const sloTarget = num(pick([raw], ['sloTarget', 'slo', 'target', 'slaTarget', 'objective'], 99.9), 99.9);
  const explicitBudget = pick([raw], ['errorBudgetUsed', 'error_budget_used', 'budget', 'errorBudget'], null);
  const errorBudgetUsed =
    explicitBudget != null
      ? Math.min(100, Math.max(0, num(explicitBudget)))
      : computeErrorBudgetUsed(computedUptime, sloTarget);

  const latencySource = isRecord(raw.latency) ? raw.latency : isRecord(raw.responseTime) ? raw.responseTime : null;
  const latency = latencySource
    ? {
        ...(latencySource.p50 != null ? { p50: num(latencySource.p50) } : {}),
        ...(latencySource.p95 != null ? { p95: num(latencySource.p95) } : {}),
        ...(latencySource.p99 != null ? { p99: num(latencySource.p99) } : {}),
      }
    : undefined;

  const activeIncidentId = str(pick([raw], ['activeIncidentId', 'incidentId', 'active_incident'], ''), '');

  return {
    id,
    name,
    ...(group.length > 0 ? { group } : {}),
    state,
    uptime: Number(computedUptime.toFixed(4)),
    sloTarget,
    errorBudgetUsed: Number(errorBudgetUsed.toFixed(2)),
    days,
    ...(latency && Object.keys(latency).length > 0 ? { latency } : {}),
    ...(activeIncidentId.length > 0 ? { activeIncidentId } : {}),
  };
}

/** Normalises one incident (statuspage `name`/`impact`/`incident_updates` included). */
export function normalizeIncident(raw: unknown, index = 0): UptimeIncident | null {
  if (!isRecord(raw)) return null;

  const title = str(pick([raw], ['title', 'name', 'summary', 'message'], ''), '');
  if (title.length === 0) return null;

  const startedAt = toEpochMs(pick([raw], ['startedAt', 'started_at', 'created_at', 'createdAt', 'at'], Date.now()));
  const resolvedRaw = pick([raw], ['resolvedAt', 'resolved_at', 'ended_at'], null);
  const state = toIncidentState(
    pick([raw], ['state', 'status', 'lifecycle'], resolvedRaw ? 'resolved' : 'investigating'),
  );

  return {
    id: str(pick([raw], ['id', 'uid', 'key'], `incident-${index}`), `incident-${index}`),
    title,
    severity: toIncidentSeverity(pick([raw], ['severity', 'impact', 'level'], 'minor')),
    state,
    startedAt,
    ...(resolvedRaw != null ? { resolvedAt: toEpochMs(resolvedRaw) } : {}),
    services: normalizeIncidentServices(raw),
    updates: normalizeUpdates(raw),
    ...(typeof raw.impact === 'number' ? { impact: num(raw.impact) } : {}),
  };
}

function normalizeUpdates(raw: Rec): UptimeIncidentUpdate[] {
  const list = firstArray(raw, ['updates', 'incident_updates', 'timeline']) ?? [];
  if (list.length === 0) return [];
  return list
    .filter(isRecord)
    .map((update) => ({
      at: toEpochMs(pick([update], ['at', 'created_at', 'createdAt', 'timestamp'], Date.now())),
      state: toIncidentState(pick([update], ['state', 'status'], 'investigating')),
      message: str(pick([update], ['message', 'body', 'text'], ''), ''),
    }))
    .filter((update) => update.message.length > 0)
    .slice(-8);
}

function normalizeIncidentServices(raw: Rec): string[] {
  const direct = raw.services ?? raw.components ?? raw.affected;
  if (Array.isArray(direct)) {
    return direct
      .map((entry) => (isRecord(entry) ? str(pick([entry], ['id', 'name'], ''), '') : str(entry, '')))
      .filter((value) => value.length > 0);
  }
  if (typeof direct === 'string' && direct.length > 0) return [direct];
  return [];
}


/**
 * Normalises the daily history.
 *
 * Accepts `days: [{ day, state, uptime, incidents }]`, plain uptime numbers
 * (`history: [99.9, 100, …]`, oldest first) and Statuspage code strings
 * (`history: 'OOODMOO'`, oldest first, `S` = maintenance).
 */
export function normalizeDays(raw: Rec): UptimeDay[] {
  const history = raw.days ?? raw.history ?? raw.timeline ?? raw.daily;
  if (history == null) return [];
  const now = num(raw.timestamp, Date.now());

  if (typeof history === 'string') {
    const codes = history.split('');
    return codes.map((code, index) => {
      const state = HISTORY_CODES[code.trim().toLowerCase()] ?? 'unknown';
      return dayFrom(index, codes.length, now, state, uptimeForState(state), []);
    });
  }

  if (!Array.isArray(history)) return [];

  return history
    .map((entry, index) => {
      if (typeof entry === 'number') {
        const uptime = Math.min(100, Math.max(0, entry));
        const state = uptime >= 100 ? 'operational' : uptime >= 99 ? 'degraded' : 'partial_outage';
        return dayFrom(index, history.length, now, state, uptime, []);
      }
      if (typeof entry === 'string') {
        const state = HISTORY_CODES[entry.trim().toLowerCase()] ?? 'unknown';
        return dayFrom(index, history.length, now, state, uptimeForState(state), []);
      }
      if (!isRecord(entry)) return null;

      const state = toServiceState(pick([entry], ['state', 'status'], 'operational'));
      const uptime = num(
        pick([entry], ['uptime', 'availability'], uptimeForState(state)),
        uptimeForState(state),
      );
      const incidentSource = entry.incidents ?? entry.incidentIds;
      const incidents = Array.isArray(incidentSource)
        ? incidentSource.map((value) => str(value, '')).filter((value) => value.length > 0)
        : [];
      const day = toEpochMs(
        pick([entry], ['day', 'date', 'at', 'timestamp'], now - (history.length - 1 - index) * DAY_MS),
      );
      const latency = pick([entry], ['latencyMs', 'latency', 'responseTime'], null);
      const result: UptimeDay = {
        day,
        state,
        uptime: Number(Math.min(100, Math.max(0, uptime)).toFixed(3)),
        incidents,
      };
      if (latency != null) result.latencyMs = num(latency);
      return result;
    })
    .filter((day): day is UptimeDay => day !== null)
    .sort((a, b) => a.day - b.day);
}

function dayFrom(
  index: number,
  total: number,
  now: number,
  state: UptimeDay['state'],
  uptime: number,
  incidents: string[],
): UptimeDay {
  return {
    day: utcDayStart(now) - (total - 1 - index) * DAY_MS,
    state,
    uptime: Number(Math.min(100, Math.max(0, uptime)).toFixed(3)),
    incidents,
  };
}

/** Default availability implied by a state, used when the payload omits it. */
function uptimeForState(state: UptimeDay['state']): number {
  switch (state) {
    case 'degraded':
      return 99.2;
    case 'partial_outage':
      return 97.5;
    case 'major_outage':
      return 80;
    default:
      return 100;
  }
}

/** Day-weighted availability across the history. */
export function averageUptime(days: readonly UptimeDay[]): number {
  if (days.length === 0) return 100;
  return days.reduce((sum, day) => sum + day.uptime, 0) / days.length;
}

/** Error budget consumed, derived from availability vs the SLO target. */
export function computeErrorBudgetUsed(uptime: number, sloTarget: number): number {
  const allowed = Math.max(0.0001, 100 - sloTarget);
  const consumed = Math.max(0, 100 - uptime);
  return Number(Math.min(100, (consumed / allowed) * 100).toFixed(2));
}

/** UTC midnight for the given epoch ms. */
export function utcDayStart(epochMs: number): number {
  return Math.floor(epochMs / DAY_MS) * DAY_MS;
}

function toEpochMs(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') return toEpochMs(numeric, fallback);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function unwrap(payload: unknown): unknown {
  let current = payload;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current)) return current;
    const inner = current.data ?? current.payload ?? current.result;
    if (inner === undefined) return current;
    current = inner;
  }
  return current;
}

function firstArray(root: Rec, keys: readonly string[]): unknown[] | null {
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

/** First defined value across the sources, falling back to `fallback`. */
function pick(raw: Array<Rec | null>, keys: readonly string[], fallback?: unknown): unknown {
  for (const source of raw) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return fallback;
}

function isService(value: UptimeService | null): value is UptimeService {
  return value !== null;
}

function isIncident(value: UptimeIncident | null): value is UptimeIncident {
  return value !== null;
}

export { worstState };

