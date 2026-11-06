import { computeHealth } from './thresholds';
import type {
  AlertInfo,
  CpuMetrics,
  DiskMetrics,
  HostInfo,
  MemoryMetrics,
  NetworkMetrics,
  ProcessInfo,
  WidgetSnapshot,
} from './types';

const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type Rec = Record<string, unknown>;

/**
 * Maps an arbitrary backend payload into a canonical `WidgetSnapshot`.
 *
 * Supported inputs:
 *  1. A canonical snapshot (all groups present) — validated with defaults filled.
 *  2. A flat metrics object (`{ cpu_usage, memory_total, ... }`) — the shape most
 *     agents and config endpoints expose, including common aliases.
 *  3. A wrapper (`{ data: ... }` / `{ payload: ... }`) which is unwrapped first.
 *
 * Returns `null` when the payload carries no usable metrics.
 */
export function normalizeSnapshot(payload: unknown): WidgetSnapshot | null {
  const root = unwrap(payload);
  if (!isRecord(root)) return null;
  // Transport control frames ("subscribed", "ping", heartbeats, ACKs) carry no
  // metrics: refuse them so they never blank out a live dashboard.
  if (!hasMetricContent(root)) return null;

  const cpu = normalizeCpu(root);
  const memory = normalizeMemory(root);
  const disk = normalizeDisk(root);
  const network = normalizeNetwork(root);
  const processes = normalizeProcesses(root, memory.total);
  const host = normalizeHost(root);
  const alerts = normalizeAlerts(root, { cpu, memory, disk, network });

  const body = {
    timestamp: num(root.timestamp ?? root.ts ?? root.time, Date.now()),
    host,
    cpu,
    memory,
    disk,
    network,
    processes,
    alerts,
  };

  const fallbackHealth = computeHealth(body);
  const health = isRecord(root.health)
    ? {
        score: num(root.health.score, fallbackHealth.score),
        grade: str(root.health.grade, fallbackHealth.grade),
        label: str(root.health.label, fallbackHealth.label),
      }
    : fallbackHealth;

  return { ...body, health };
}

function unwrap(payload: unknown): unknown {
  if (isRecord(payload)) {
    for (const key of ['data', 'payload', 'result', 'snapshot']) {
      const inner = payload[key];
      if (isRecord(inner)) return inner;
    }
  }
  return payload;
}

/**
 * Keys that may appear on a control frame. Everything else is treated as metric
 * content — the list is intentionally small so unknown metric names still pass.
 */
const CONTROL_KEYS = new Set(['type', 'event', 'stream', 'channel', 'id', 'seq', 'code', 'status']);

const TIME_KEYS = new Set(['timestamp', 'time', 'ts', 't', 'date', 'created_at', 'updated_at']);

const METRIC_KEY_PATTERN =
  /(cpu|processor|core|mem|ram|disk|storage|filesystem|fs|network|net|io|host|system|server|uptime|load|usage|percent|process|alert|incident|rss|swap|latency|partition|interface)/i;

/**
 * True when a payload actually carries metrics.
 *
 * Guards the pipeline against control frames (`{"type":"subscribed"}`,
 * `{"type":"ping","t":123}`, presence events…) that would otherwise be
 * normalised into an all-zero snapshot and blank out a live dashboard.
 */
export function hasMetricContent(root: Rec): boolean {
  const hasControlMarker = ['type', 'event', 'stream', 'channel'].some(
    (key) => typeof root[key] === 'string',
  );

  for (const [key, value] of Object.entries(root)) {
    const lower = key.toLowerCase();
    if (CONTROL_KEYS.has(lower)) continue;
    if (METRIC_KEY_PATTERN.test(key)) return true;
    // Timestamps alone only count for real payloads, never for control frames.
    if (TIME_KEYS.has(lower)) {
      if (!hasControlMarker) return true;
      continue;
    }
    if (isRecord(value) && Object.keys(value).length > 0) return true;
  }
  return false;
}

function group(root: Rec, keys: readonly string[]): Rec | null {
  for (const key of keys) {
    const value = root[key];
    if (isRecord(value)) return value;
  }
  return null;
}

function pick<T = unknown>(sources: Array<Rec | null>, keys: readonly string[], fallback: T): T {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return value as T;
    }
  }
  return fallback;
}

function normalizeCpu(root: Rec): CpuMetrics {
  const cpu = group(root, ['cpu', 'processor']);
  const sources = [cpu, root];
  const usage = clampPercent(
    num(
      pick(sources, ['usage', 'usagePercent', 'usage_percent', 'percent', 'cpu_usage', 'utilisation', 'utilization'], 0),
    ),
  );
  const perCoreRaw = pick<unknown[]>(sources, ['perCore', 'per_core', 'coreUsage', 'core_usage'], []);
  const perCore = arr(perCoreRaw).map((v) => clampPercent(num(v))).slice(0, 256);

  const coresRaw = pick<unknown>(sources, ['cores', 'coreCount', 'core_count', 'logicalCores', 'cpu_cores'], null);
  const cores = Math.max(1, Math.round(num(coresRaw, perCore.length || 1)));

  const loadRaw = pick<unknown[]>(sources, ['load', 'loadAvg', 'load_avg', 'loadAverage'], []);
  const load: [number, number, number] = Array.isArray(loadRaw)
    ? [num(loadRaw[0]), num(loadRaw[1]), num(loadRaw[2])]
    : [
        num(pick(sources, ['load1', 'load_1'], 0)),
        num(pick(sources, ['load5', 'load_5'], 0)),
        num(pick(sources, ['load15', 'load_15'], 0)),
      ];

  const temperature = pick<unknown>(sources, ['temperature', 'temp', 'cpu_temp'], null);
  const breakdownRaw = group(root, ['breakdown', 'cpuBreakdown']);
  const breakdown = breakdownRaw
    ? {
        user: clampPercent(num(breakdownRaw.user)),
        system: clampPercent(num(breakdownRaw.system)),
        iowait: clampPercent(num(breakdownRaw.iowait ?? breakdownRaw.io_wait)),
        idle: clampPercent(num(breakdownRaw.idle, Math.max(0, 100 - usage))),
      }
    : undefined;

  const model = str(pick(sources, ['model', 'brand'], ''), '');

  return {
    usage,
    // Every core always has a sample so the bar chart is never partially empty.
    perCore: perCore.length > 0 ? perCore : new Array<number>(cores).fill(usage),
    load,
    cores: Math.max(cores, perCore.length),
    ...(model ? { model } : {}),
    temperature: temperature == null ? null : num(temperature),
    ...(breakdown ? { breakdown } : {}),
  };
}

function normalizeMemory(root: Rec): MemoryMetrics {
  const mem = group(root, ['memory', 'mem', 'ram']);
  const sources = [mem, root];
  const total = Math.max(
    0,
    num(pick(sources, ['total', 'totalBytes', 'total_bytes', 'total_ram', 'memory_total', 'memoryTotal', 'mem_total'], 0)),
  );
  let used = num(pick(sources, ['used', 'usedBytes', 'used_bytes', 'memory_used', 'memoryUsed', 'mem_used'], Number.NaN));
  if (!Number.isFinite(used)) {
    const free = num(
      pick(sources, ['free', 'available', 'freeBytes', 'memory_free', 'memoryFree', 'mem_available'], Number.NaN),
    );
    used = Number.isFinite(free) ? Math.max(0, total - free) : 0;
  }
  const explicitUsage = pick<unknown>(
    sources,
    ['usage', 'usagePercent', 'usage_percent', 'percent', 'memory_usage', 'memoryUsage'],
    null,
  );
  const usage =
    explicitUsage == null ? (total > 0 ? (used / total) * 100 : 0) : clampPercent(num(explicitUsage));

  return {
    total,
    used: Math.max(0, used),
    free: Math.max(0, total - used),
    cached: num(pick(sources, ['cached', 'cache', 'buffers', 'buff_cache'], 0)),
    swapTotal: num(pick(sources, ['swapTotal', 'swap_total', 'swap'], 0)),
    swapUsed: num(pick(sources, ['swapUsed', 'swap_used'], 0)),
    usage: Number(clampPercent(usage).toFixed(1)),
  };
}


function normalizeDisk(root: Rec): DiskMetrics {
  const disk = group(root, ['disk', 'storage', 'filesystem', 'fs']);
  const sources = [disk, root];
  const partitionsRaw = pick<unknown[]>(sources, ['partitions', 'mounts', 'disks', 'volumes'], []);
  const partitions = arr(partitionsRaw)
    .filter(isRecord)
    .map((entry) => {
      const total = num(pick([entry], ['total', 'size', 'totalBytes'], 0));
      const used = num(pick([entry], ['used', 'usedBytes'], 0));
      const usageRaw = pick<unknown>(
        [entry],
        ['usage', 'usagePercent', 'usage_percent', 'percent'],
        total > 0 ? (used / total) * 100 : 0,
      );
      const usage = clampPercent(num(usageRaw));
      return {
        name: str(pick([entry], ['name', 'mount', 'mountpoint', 'path', 'device'], '/')),
        total,
        used,
        free: Math.max(0, total - used),
        usage: Number(usage.toFixed(1)),
        status: statusOf(usage, 80, 90),
      };
    });

  const total =
    num(pick(sources, ['total', 'totalBytes', 'disk_total', 'diskTotal'], 0)) ||
    partitions.reduce((sum, p) => sum + p.total, 0);
  let used = num(pick(sources, ['used', 'usedBytes', 'disk_used', 'diskUsed'], Number.NaN));
  if (!Number.isFinite(used)) {
    const rootPartition = partitions.find((p) => p.name === '/');
    used = rootPartition ? rootPartition.used : partitions.reduce((sum, p) => sum + p.used, 0);
  }
  const explicitUsage = pick<unknown>(
    sources,
    ['usage', 'usagePercent', 'usage_percent', 'percent', 'disk_usage', 'diskUsage'],
    null,
  );
  const usage =
    explicitUsage == null ? (total > 0 ? (used / total) * 100 : 0) : clampPercent(num(explicitUsage));

  return {
    total,
    used,
    free: Math.max(0, total - used),
    usage: Number(clampPercent(usage).toFixed(1)),
    readBytesPerSec: num(pick(sources, ['readBytesPerSec', 'read_bytes_per_sec', 'readRate', 'read_bps'], 0)),
    writeBytesPerSec: num(
      pick(sources, ['writeBytesPerSec', 'write_bytes_per_sec', 'writeRate', 'write_bps'], 0),
    ),
    partitions,
  };
}

function normalizeNetwork(root: Rec): NetworkMetrics {
  const net = group(root, ['network', 'net', 'io']);
  const sources = [net, root];
  const interfaces = arr(pick<unknown[]>(sources, ['interfaces', 'nics', 'adapters'], []))
    .filter(isRecord)
    .map((entry) => ({
      name: str(pick([entry], ['name', 'interface', 'device'], 'eth0')),
      rxBytesPerSec: num(pick([entry], ['rxBytesPerSec', 'rx_rate', 'rxPerSec', 'rx'], 0)),
      txBytesPerSec: num(pick([entry], ['txBytesPerSec', 'tx_rate', 'txPerSec', 'tx'], 0)),
      rxTotal: num(pick([entry], ['rxTotal', 'rx_total', 'rxBytes'], 0)),
      txTotal: num(pick([entry], ['txTotal', 'tx_total', 'txBytes'], 0)),
    }));

  const rxBytesPerSec =
    num(pick(sources, ['rxBytesPerSec', 'rx_rate', 'rxPerSec', 'rx_bps'], 0)) ||
    interfaces.reduce((sum, i) => sum + i.rxBytesPerSec, 0);
  const txBytesPerSec =
    num(pick(sources, ['txBytesPerSec', 'tx_rate', 'txPerSec', 'tx_bps'], 0)) ||
    interfaces.reduce((sum, i) => sum + i.txBytesPerSec, 0);
  const latency = pick<unknown>(sources, ['latencyMs', 'latency', 'ping', 'rtt'], null);
  const packetLoss = pick<unknown>(sources, ['packetLoss', 'loss'], null);

  return {
    rxBytesPerSec,
    txBytesPerSec,
    rxTotal: num(pick(sources, ['rxTotal', 'rx_total'], 0)),
    txTotal: num(pick(sources, ['txTotal', 'tx_total'], 0)),
    latencyMs: latency == null ? null : num(latency),
    packetLoss: packetLoss == null ? null : num(packetLoss),
    interfaces,
  };
}


function normalizeProcesses(root: Rec, totalMemory: number): ProcessInfo[] {
  const list = arr(pick<unknown[]>([root], ['processes', 'procs', 'topProcesses'], []));
  return list
    .filter(isRecord)
    .map((entry) => {
      const memory = num(pick([entry], ['memory', 'rss', 'memBytes', 'memoryBytes'], 0));
      const explicitPercent = pick<unknown>([entry], ['memoryPercent', 'memPercent', 'mem_percent'], null);
      return {
        pid: Math.round(num(pick([entry], ['pid'], 0))),
        name: str(pick([entry], ['name', 'command', 'cmd'], 'unknown')),
        cpu: Number(num(pick([entry], ['cpu', 'cpuPercent', 'cpu_usage'], 0)).toFixed(1)),
        memory,
        memoryPercent:
          explicitPercent == null
            ? totalMemory > 0
              ? Number(((memory / totalMemory) * 100).toFixed(1))
              : 0
            : Number(clampPercent(num(explicitPercent)).toFixed(1)),
        user: str(pick([entry], ['user', 'owner'], ''), ''),
      };
    })
    .sort((a, b) => b.cpu - a.cpu);
}

function normalizeHost(root: Rec): HostInfo {
  const host = group(root, ['host', 'system', 'server']);
  const sources = [host, root];
  const optional = (keys: readonly string[]): string | undefined => {
    const value = str(pick(sources, keys, ''), '');
    return value.length > 0 ? value : undefined;
  };
  return {
    name: str(pick(sources, ['name', 'hostname', 'host_name', 'serverName'], 'unknown-host')),
    os: str(pick(sources, ['os', 'osName', 'distribution'], 'unknown')),
    platform: str(pick(sources, ['platform'], 'unknown')),
    uptime: num(pick(sources, ['uptime', 'uptimeSeconds', 'uptime_seconds'], 0)),
    ip: optional(['ip', 'ipAddress', 'address']),
    region: optional(['region', 'zone', 'datacenter']),
    kernel: optional(['kernel', 'kernelVersion']),
    avatarUrl: optional(['avatarUrl', 'avatar', 'icon']),
  };
}

function normalizeAlerts(
  root: Rec,
  metrics: { cpu: CpuMetrics; memory: MemoryMetrics; disk: DiskMetrics; network: NetworkMetrics },
): AlertInfo[] {
  const raw = root.alerts ?? root.incidents;
  if (Array.isArray(raw)) {
    return raw.filter(isRecord).map((entry, index) => {
      const value = pick<unknown>([entry], ['value'], null);
      const since = pick<unknown>([entry], ['since', 'startedAt', 'startTime'], null);
      const message = str(pick([entry], ['message', 'description'], ''), '');
      return {
        id: str(pick([entry], ['id'], `alert-${index}`)),
        title: str(pick([entry], ['title', 'name', 'summary'], 'Alert')),
        severity: normalizeSeverity(pick([entry], ['severity', 'level', 'state'], 'warning')),
        metric: str(pick([entry], ['metric'], ''), ''),
        value: value == null ? undefined : num(value),
        since: since == null ? undefined : num(since),
        message: message.length > 0 ? message : undefined,
      };
    });
  }

  // No explicit alert list: derive from the readings so the badge and the status
  // rings still reflect reality.
  const derived: AlertInfo[] = [];
  if (metrics.disk.usage >= 80) {
    derived.push({
      id: 'disk-usage',
      title: 'Disk usage high',
      severity: metrics.disk.usage >= 90 ? 'critical' : 'warning',
      metric: 'disk',
      value: metrics.disk.usage,
    });
  }
  if (metrics.cpu.usage >= 85) {
    derived.push({
      id: 'cpu-usage',
      title: 'CPU saturation',
      severity: 'critical',
      metric: 'cpu',
      value: metrics.cpu.usage,
    });
  }
  if (metrics.memory.usage >= 85) {
    derived.push({
      id: 'memory-usage',
      title: 'Memory pressure',
      severity: 'warning',
      metric: 'memory',
      value: metrics.memory.usage,
    });
  }
  if ((metrics.network.latencyMs ?? 0) >= 300) {
    derived.push({
      id: 'network-latency',
      title: 'Network latency high',
      severity: 'warning',
      metric: 'network',
      value: metrics.network.latencyMs ?? 0,
    });
  }
  return derived;
}

function normalizeSeverity(value: unknown): AlertInfo['severity'] {
  const text = String(value ?? '').toLowerCase();
  if (text.startsWith('crit') || text === 'error' || text === 'high' || text === 'fatal') return 'critical';
  if (text.startsWith('warn') || text === 'medium') return 'warning';
  return 'info';
}

function statusOf(value: number, warning: number, critical: number) {
  return value >= critical ? ('critical' as const) : value >= warning ? ('warning' as const) : ('ok' as const);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Number(value.toFixed(1))));
}

