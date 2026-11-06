import type { LogEntry, LogLevel, LogSnapshot } from './log-types';

/**
 * Deterministic synthetic log generator.
 *
 * Powers the demo app, the mock server and the unit tests so the log widget can
 * be developed without a backend. Returns realistic-looking lines for a handful
 * of services, with occasional bursts of warnings/errors.
 */
export interface MockLogOptions {
  seed?: number;
  /** Elapsed seconds driving the timeline (defaults to wall clock). */
  elapsedSeconds?: number;
  /** Number of lines per batch (default 4). */
  count?: number;
  /** Services that may appear (defaults to a small fleet). */
  services?: string[];
  hostname?: string;
  /** Force an error burst (demo/tests). */
  burst?: boolean;
}

const DEFAULT_SERVICES = ['api-gateway', 'auth-service', 'postgres', 'worker', 'cache', 'edge-proxy'];

const TEMPLATES: Record<LogLevel, readonly string[]> = {
  trace: ['cache lookup {key} took {ms}ms', 'entering handler {path}', 'pool checkout id={id}'],
  debug: ['resolved {key} in {ms}ms', 'retry attempt {n} for {path}', 'flushed {n} rows to sink'],
  info: [
    'request {method} {path} completed in {ms}ms',
    'connection pool size {n}',
    'checkpoint written at offset {n}',
    'registered worker {id}',
  ],
  warn: [
    'slow query {ms}ms for {path}',
    'queue depth {n} above threshold',
    'retrying upstream after 503 from {path}',
    'connection reuse dropped for {id}',
  ],
  error: [
    'upstream timeout after {ms}ms calling {path}',
    'failed to write batch: {reason}',
    'connection reset by peer while serving {path}',
  ],
  fatal: ['unable to acquire connection after {n} retries', 'shutting down: {reason}'],
};

const REASONS = ['deadline exceeded', 'disk quota', 'invalid payload', 'TLS handshake'];
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const PATHS = ['/v1/orders', '/v1/users/{id}', '/healthz', '/v1/search', '/v1/billing/invoices'];

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

function fill(template: string, random: () => number): string {
  return template
    .replace('{key}', () => `user:${Math.floor(random() * 9000) + 1000}`)
    .replace('{id}', () => String(Math.floor(random() * 9999)))
    .replace('{path}', () => PATHS[Math.floor(random() * PATHS.length)]!)
    .replace('{method}', () => METHODS[Math.floor(random() * METHODS.length)]!)
    .replace('{reason}', () => REASONS[Math.floor(random() * REASONS.length)]!)
    .replace('{ms}', () => String(Math.round(4 + random() * 380)))
    .replace('{n}', () => String(Math.round(random() * 900) + 1));
}

/** Picks a level for the next line, biased by the burst flag. */
function pickLevel(random: () => number, burst: boolean): LogLevel {
  const roll = random();
  if (burst) {
    if (roll < 0.42) return 'error';
    if (roll < 0.62) return 'fatal';
    if (roll < 0.9) return 'warn';
    return 'info';
  }
  if (roll < 0.04) return 'error';
  if (roll < 0.16) return 'warn';
  if (roll < 0.5) return 'debug';
  if (roll < 0.64) return 'trace';
  return 'info';
}

/**
 * Builds one batch of synthetic log lines.
 *
 * The generator is seeded so repeated calls with the same `elapsedSeconds`
 * produce identical batches — which keeps tests and screenshots reproducible.
 */
export function createMockLogSnapshot(options: MockLogOptions = {}): LogSnapshot {
  const {
    seed = 42,
    elapsedSeconds = Date.now() / 1000,
    count = 4,
    services = DEFAULT_SERVICES,
    hostname = 'prod-edge-01',
    burst = false,
  } = options;

  const random = mulberry32(seed + Math.floor(elapsedSeconds * 3));
  const base = Date.now();
  const entries: LogEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    const level = pickLevel(random, burst || isBurstWindow(elapsedSeconds));
    const service = services[Math.floor(random() * services.length)] ?? services[0]!;
    const templates = TEMPLATES[level];
    const template = templates[Math.floor(random() * templates.length)]!;
    const timestamp = base - Math.round((count - index) * (120 + random() * 380));

    const entry: LogEntry = {
      id: `mock-${Math.floor(timestamp)}-${index}-${level}`,
      timestamp,
      level,
      service,
      message: fill(template, random),
      host: hostname,
      pid: 1000 + Math.floor(random() * 900),
    };

    entry.traceId = `tr-${Math.floor(random() * 0xffffffff).toString(16).padStart(8, '0')}`;
    entry.pid = 1000 + Math.floor(random() * 900);
    entry.attributes = {
      region: 'eu-central-1',
      attempt: Math.round(random() * 4) + 1,
    };

    entries.push(entry);
  }

  return { timestamp: base, entries };
}

/** A short, repeating "incident window" so charts and alert paths get exercised. */
function isBurstWindow(elapsedSeconds: number): boolean {
  const phase = elapsedSeconds % 60;
  return phase >= 46 && phase < 54;
}

/** Convenience for tests: one batch with a forced level mix. */
export function createMockLogEntry(level: LogLevel, message: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `mock-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: Date.now(),
    level,
    service: 'auth-service',
    message,
    ...overrides,
  };
}
