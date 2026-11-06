import { toLogLevel, type LogAttributeValue, type LogEntry, type LogSnapshot } from './log-types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' ? String(value) : fallback;

/** Parses seconds, milliseconds, micro/nanoseconds and ISO strings into epoch ms. */
export function toEpochMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: >= 1e17 is nanoseconds, >= 1e14 microseconds, < 1e11 seconds.
    if (value >= 1e17) return Math.round(value / 1e6);
    if (value >= 1e14) return Math.round(value / 1e3);
    if (value < 1e11) return Math.round(value * 1000);
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== '') return toEpochMs(asNumber, fallback);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

let sequence = 0;

/**
 * Maps an arbitrary backend payload into a `LogSnapshot`.
 *
 * Accepted shapes:
 *   - an array of lines
 *   - `{ entries | logs | lines | messages | records | items: [...] }`
 *   - `{ data: [...] }` / `{ data: { entries: [...] } }` / `{ payload: ... }`
 *   - a single line object (`{ level, message, ... }`) — common on streaming sockets
 *
 * Returns `null` for payloads without any log line (control frames, heartbeats…).
 */
export function normalizeLogSnapshot(payload: unknown): LogSnapshot | null {
  const root = unwrap(payload);

  if (Array.isArray(root)) {
    const entries = root.map((line, index) => normalizeLogEntry(line, index)).filter(isEntry);
    return entries.length > 0 ? { timestamp: Date.now(), entries } : null;
  }

  if (!isRecord(root)) return null;

  const list = firstArray(root, ['entries', 'logs', 'lines', 'messages', 'records', 'items']);
  if (list) {
    const entries = list.map((line, index) => normalizeLogEntry(line, index)).filter(isEntry);
    // An explicitly empty batch is meaningful ("nothing new"), an unusable one is not.
    return entries.length > 0 || list.length === 0 ? { timestamp: Date.now(), entries } : null;
  }

  // A single line arrives on its own when streaming line by line.
  const single = normalizeLogEntry(root, 0);
  return single ? { timestamp: Date.now(), entries: [single] } : null;
}

/** Normalises one line; returns `null` when the object carries no message. */
export function normalizeLogEntry(raw: unknown, index = 0): LogEntry | null {
  if (typeof raw === 'string') {
    const message = raw.trim();
    return message.length > 0
      ? { id: nextId(), timestamp: Date.now(), level: 'info', service: 'app', message }
      : null;
  }
  if (!isRecord(raw)) return null;

  const message = pickString(raw, ['message', 'msg', 'text', 'line', 'body', 'event', 'log']);
  if (!message) return null;

  const entry: LogEntry = {
    id: nextId(),
    timestamp: toEpochMs(pick(raw, ['timestamp', 'ts', 'time', 'date', 'created_at', '@timestamp']), Date.now()),
    level: toLogLevel(pick(raw, ['level', 'severity', 'lvl', 'priority', 'status'])),
    service: str(
      pick(raw, ['service', 'app', 'application', 'container', 'logger', 'module', 'source', 'component', 'namespace']),
      'app',
    ),
    message,
  };

  const host = str(pick(raw, ['host', 'hostname', 'node', 'pod', 'instance']), '');
  if (host) entry.host = host;

  const pid = pick(raw, ['pid', 'processId', 'process_id']);
  if (typeof pid === 'number' || typeof pid === 'string') entry.pid = Number(pid);

  const traceId = str(pick(raw, ['trace_id', 'traceId', 'requestId', 'request_id']), '');
  if (traceId) entry.traceId = traceId;

  const line = pick(raw, ['line_number', 'lineNumber', 'line_no']);
  if (typeof line === 'number') entry.line = line;

  const repeat = pick(raw, ['repeat', 'count', 'duplicates']);
  if (typeof repeat === 'number' && repeat > 1) entry.repeat = repeat;

  const attributes = collectAttributes(raw);
  if (Object.keys(attributes).length > 0) entry.attributes = attributes;

  // Keep provided ids unique so selection and hit regions stay stable per frame.
  const provided = str(pick(raw, ['id', 'uid']), '');
  if (provided) entry.id = `${provided}-${index}`;

  return entry;
}


const RESERVED = new Set([
  'id', 'uid', 'level', 'severity', 'lvl', 'priority', 'status',
  'message', 'msg', 'text', 'line', 'body', 'event', 'log', 'line_number', 'lineNumber', 'line_no',
  'service', 'app', 'application', 'container', 'logger', 'module', 'source', 'component', 'namespace',
  'timestamp', 'ts', 'time', 'date', 'created_at', '@timestamp',
  'pid', 'processId', 'process_id', 'host', 'hostname', 'node', 'pod', 'instance',
  'trace_id', 'traceId', 'requestId', 'request_id', 'repeat', 'count', 'duplicates',
  'attributes', 'fields', 'labels', 'meta',
]);

/** Everything that is not a known top-level field becomes a detail attribute. */
function collectAttributes(raw: Record<string, unknown>): Record<string, LogAttributeValue> {
  const attributes: Record<string, LogAttributeValue> = {};

  const explicit = raw.attributes ?? raw.fields ?? raw.labels ?? raw.meta;
  if (isRecord(explicit)) {
    for (const [key, value] of Object.entries(explicit)) {
      if (value === undefined) continue;
      attributes[key] =
        typeof value === 'object' && value !== null ? JSON.stringify(value) : (value as LogAttributeValue);
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED.has(key) || key in attributes || value === undefined || value === null) continue;
    if (typeof value === 'object') {
      attributes[key] = JSON.stringify(value);
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attributes[key] = value;
    }
  }
  return attributes;
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

function firstArray(root: Record<string, unknown>, keys: readonly string[]): unknown[] | null {
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function pick(raw: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function pickString(raw: Record<string, unknown>, keys: readonly string[]): string {
  const value = pick(raw, keys);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function isEntry(value: LogEntry | null): value is LogEntry {
  return value !== null;
}

function nextId(): string {
  sequence += 1;
  return `log-${sequence}`;
}

