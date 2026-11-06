/**
 * Log contracts for the log-stream widget (and any other log based widget).
 * Kept in `core` so every widget and host speaks the same shape.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Ordered from least to most severe — handy for filters and colour scales. */
export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export const LEVEL_SEVERITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/** Structured attribute value shown in the detail panel. */
export type LogAttributeValue = string | number | boolean | null;

export interface LogEntry {
  /** Stable id (used for selection, de-duplication and hit regions). */
  id: string;
  /** Epoch milliseconds. */
  timestamp: number;
  level: LogLevel;
  /** Emitting service / container / app. */
  service: string;
  message: string;
  host?: string;
  pid?: number;
  traceId?: string;
  /** Extra key/value attributes (labels, fields, …). */
  attributes?: Record<string, LogAttributeValue>;
  /** How many identical lines were collapsed into this one. */
  repeat?: number;
  /** Line number in the source stream, when the backend provides one. */
  line?: number;
}

/** A batch of log lines. An empty batch is valid and simply means "nothing new". */
export interface LogSnapshot {
  timestamp: number;
  entries: LogEntry[];
}

export interface LogFilter {
  /** Levels to keep; empty array means "all levels". */
  levels: LogLevel[];
  /** Services to keep; empty array means "all services". */
  services: string[];
  /** Free-text query matched against message, service and attributes. */
  query: string;
  /** Minimum severity shortcut (`error` keeps error + fatal). */
  minLevel?: LogLevel | 'all';
}

export const emptyLogFilter: LogFilter = { levels: [], services: [], query: '', minLevel: 'all' };

export interface LogServiceStat {
  service: string;
  count: number;
  errorCount: number;
}

export interface LogStats {
  /** Entries currently buffered. */
  total: number;
  /** Lines ingested since the last `clear()` (including evicted ones). */
  received: number;
  byLevel: Record<LogLevel, number>;
  byService: LogServiceStat[];
  /** Errors per second over the last window. */
  errorRate: number;
}

/** One histogram bucket: volume per level in a time slice. */
export interface LogBucket {
  /** Bucket start, epoch ms. */
  t: number;
  counts: Record<LogLevel, number>;
  total: number;
}

/** True when `level` is at least `min`. */
export function levelAtLeast(level: LogLevel, min: LogLevel): boolean {
  return LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[min];
}

/** Normalises free-form severity strings (`WARNING`, `ERR`, `critical`, …). */
export function toLogLevel(value: unknown): LogLevel {
  const text = String(value ?? 'info').trim().toLowerCase();
  if (text.startsWith('trace') || text === 'verbose') return 'trace';
  if (text.startsWith('dbg') || text.startsWith('debug')) return 'debug';
  if (text.startsWith('warn')) return 'warn';
  if (text.startsWith('err') || text === 'severe') return 'error';
  if (text.startsWith('crit') || text.startsWith('fatal') || text === 'panic' || text === 'emerg') return 'fatal';
  return 'info';
}
