/**
 * Canonical data contracts for the Widgets collection.
 *
 * Everything a widget renders comes from a `WidgetSnapshot`. Transports are
 * responsible for producing that shape (or a payload that `normalizeSnapshot`
 * can map into it), which keeps widgets completely agnostic about the backend.
 */

/** Severity of a metric reading, derived from configurable thresholds. */
export type StatusLevel = 'ok' | 'warning' | 'critical' | 'unknown';

/** A single reading with an optional explicit status. */
export interface MetricReading {
  /** Current value in the metric's natural unit (percent, bytes, ms, ...). */
  value: number;
  /** Classification derived from thresholds. */
  status: StatusLevel;
}

export interface CpuMetrics {
  /** Total CPU utilisation, 0..100. */
  usage: number;
  /** Utilisation per logical core, 0..100 each. */
  perCore: number[];
  /** 1 / 5 / 15 minute load averages. */
  load: [number, number, number];
  /** Number of logical cores. */
  cores: number;
  /** CPU model string, when the agent can provide it. */
  model?: string;
  /** Package temperature in Celsius, when available. */
  temperature?: number | null;
  /** Per-state breakdown in percent (user/system/iowait/idle). */
  breakdown?: {
    user: number;
    system: number;
    iowait?: number;
    idle: number;
  };
}

export interface MemoryMetrics {
  /** Total RAM in bytes. */
  total: number;
  /** Used RAM in bytes. */
  used: number;
  /** Free RAM in bytes. */
  free: number;
  /** Cache/buffer bytes (counted as reclaimable). */
  cached?: number;
  /** Swap total bytes. */
  swapTotal: number;
  /** Swap used bytes. */
  swapUsed: number;
  /** Used / total * 100. */
  usage: number;
}

export interface DiskPartition {
  /** Mount point or device label. */
  name: string;
  total: number;
  used: number;
  free: number;
  usage: number;
  status: StatusLevel;
}

export interface DiskMetrics {
  total: number;
  used: number;
  free: number;
  usage: number;
  /** Aggregate read throughput in bytes/second. */
  readBytesPerSec: number;
  /** Aggregate write throughput in bytes/second. */
  writeBytesPerSec: number;
  /** Individual mounts, largest first. */
  partitions: DiskPartition[];
}

export interface NetworkInterfaceMetrics {
  name: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxTotal: number;
  txTotal: number;
}

export interface NetworkMetrics {
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxTotal: number;
  txTotal: number;
  /** Round-trip latency in milliseconds, when measured. */
  latencyMs?: number | null;
  /** Packet loss ratio 0..100, when measured. */
  packetLoss?: number | null;
  interfaces: NetworkInterfaceMetrics[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  /** CPU usage in percent of a single core. */
  cpu: number;
  /** Resident memory in bytes. */
  memory: number;
  /** Memory as percentage of total RAM. */
  memoryPercent?: number;
  user?: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertInfo {
  id: string;
  title: string;
  severity: AlertSeverity;
  /** Metric key that triggered the alert (cpu, memory, disk, ...). */
  metric?: string;
  value?: number;
  since?: number;
  message?: string;
}

export interface HostInfo {
  name: string;
  os: string;
  platform: string;
  /** Uptime in seconds. */
  uptime: number;
  ip?: string;
  region?: string;
  kernel?: string;
  /** Logo/avatar URL rendered in the host card. */
  avatarUrl?: string;
}

export interface HealthSummary {
  /** 0..100 composite health score. */
  score: number;
  /** Letter grade, e.g. "A+". */
  grade: string;
  /** Short human readable state, e.g. "healthy". */
  label: string;
}

/** The single object every widget renders. */
export interface WidgetSnapshot {
  /** Unix epoch milliseconds. */
  timestamp: number;
  host: HostInfo;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  processes: ProcessInfo[];
  alerts: AlertInfo[];
  health: HealthSummary;
}

/** Generic time series used for the history buffers / charts. */
export interface TimeSeriesPoint {
  t: number;
  v: number;
}

/** Named history series stored by the widget store. */
export interface MetricHistory {
  cpu: TimeSeriesPoint[];
  memory: TimeSeriesPoint[];
  disk: TimeSeriesPoint[];
  networkRx: TimeSeriesPoint[];
  networkTx: TimeSeriesPoint[];
  load: TimeSeriesPoint[];
}

export type HistoryKey = keyof MetricHistory;

/** Threshold definition for one metric. */
export interface ThresholdRule {
  /** Value at/above which the metric turns `warning` (percent scale). */
  warning: number;
  /** Value at/above which the metric turns `critical` (percent scale). */
  critical: number;
}

export interface ThresholdConfig {
  cpu: ThresholdRule;
  memory: ThresholdRule;
  disk: ThresholdRule;
  /** Network latency rule, in milliseconds. */
  latency: ThresholdRule;
  /** Swap usage rule, in percent of swap total. */
  swap: ThresholdRule;
}

/** Connection lifecycle state exposed by every transport. */
export type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error' | 'closed';

export interface TransportStatus {
  state: ConnectionState;
  /** Number of successful messages received since the transport started. */
  received: number;
  /** Epoch ms of the last message, or 0 when none arrived yet. */
  lastMessageAt: number;
  /** Last error, when the connection failed. */
  error?: Error | null;
  /** Consecutive reconnect attempts so far. */
  attempts?: number;
}
