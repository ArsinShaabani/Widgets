import { computeHealth, swapUsagePercent } from './thresholds';
import type { AlertInfo, ProcessInfo, WidgetSnapshot } from './types';

/**
 * Deterministic synthetic metric generator.
 *
 * Used by the demo app, the mock server and unit tests: it produces a
 * realistic-looking `WidgetSnapshot` from a seed + elapsed time so any widget can
 * be developed in isolation from a real agent.
 */
export interface MockSnapshotOptions {
  /** Seed for the deterministic pseudo random generator. */
  seed?: number;
  /** Elapsed seconds used to animate the series (defaults to wall clock). */
  elapsedSeconds?: number;
  /** Hostname reported in the snapshot. */
  hostname?: string;
  /** Number of logical cores. */
  cores?: number;
  /** Baseline CPU utilisation, 0..100. */
  cpuBaseline?: number;
}

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

const PROCESS_NAMES = [
  'postgres',
  'node',
  'nginx',
  'redis-server',
  'java',
  'dockerd',
  'python3',
  'kworker',
  'systemd-journald',
  'prometheus',
  'chromium',
  'mysqld',
];

const TOTAL_MEMORY = 64 * 1024 ** 3;
const TOTAL_DISK = 1024 * 1024 ** 3;

/**
 * Wave helper: combines a slow sine with a faster harmonic plus noise so charts
 * look organic instead of saw-toothed.
 */
function wave(t: number, period: number, phase = 0): number {
  return (Math.sin(t / period + phase) + 1) / 2;
}

/** Clamps a number into the inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Builds one deterministic synthetic snapshot for the given moment. */
export function createMockSnapshot(options: MockSnapshotOptions = {}): WidgetSnapshot {
  const { seed = 7, hostname = 'prod-edge-01', cores = 16, cpuBaseline = 46 } = options;
  const elapsed = options.elapsedSeconds ?? Date.now() / 1000;
  const random = mulberry32(seed + Math.floor(elapsed / 5));

  const cpuUsage = clamp(
    cpuBaseline + wave(elapsed, 17) * 28 + wave(elapsed, 5, 1.7) * 12 + random() * 6,
    3,
    99,
  );
  const perCore = Array.from({ length: cores }, (_, i) =>
    clamp(cpuUsage + wave(elapsed, 3 + i * 0.23, i) * 34 - 17 + (random() - 0.5) * 10, 1, 100),
  );

  const memUsedRatio = clamp(0.5 + wave(elapsed, 29, 0.4) * 0.28 + random() * 0.05, 0.15, 0.97);
  const memoryUsed = Math.round(TOTAL_MEMORY * memUsedRatio);
  const cached = Math.round(TOTAL_MEMORY * 0.18);
  const swapTotal = 8 * 1024 ** 3;
  const swapUsed = Math.round(swapTotal * clamp(wave(elapsed, 61, 2.2) * 0.4, 0, 0.95));

  const diskUsage = clamp(68 + wave(elapsed, 240) * 14, 20, 96);
  const diskUsed = Math.round(TOTAL_DISK * (diskUsage / 100));
  const readBytesPerSec = Math.round((30 + wave(elapsed, 9) * 180) * 1024 ** 2 * (0.5 + random()));
  const writeBytesPerSec = Math.round((12 + wave(elapsed, 13, 1.1) * 90) * 1024 ** 2 * (0.5 + random()));

  const rxBytesPerSec = Math.round((40 + wave(elapsed, 11, 0.6) * 420) * 1024 ** 2 * (0.4 + random() * 0.8));
  const txBytesPerSec = Math.round((20 + wave(elapsed, 7, 2.4) * 260) * 1024 ** 2 * (0.4 + random() * 0.8));

  const processes: ProcessInfo[] = PROCESS_NAMES.slice(0, 6).map((name, index) => {
    const cpu = clamp(cpuUsage * (0.55 - index * 0.09) + wave(elapsed, 4 + index, index) * 9, 0.2, 100);
    const memory = Math.round(
      memoryUsed * (0.3 - index * 0.038) * clamp(1 + wave(elapsed, 7, index) * 0.3, 0.3, 1.6),
    );
    return {
      pid: 1001 + index * 137,
      name,
      cpu: Number(cpu.toFixed(1)),
      memory,
      memoryPercent: Number(((memory / TOTAL_MEMORY) * 100).toFixed(1)),
      user: index % 2 === 0 ? 'www-data' : 'system',
    };
  });

  const alerts = buildAlerts(cpuUsage, memUsedRatio, diskUsage);
  const base = buildSnapshotBase({
    cpuUsage,
    perCore,
    cores,
    random,
    elapsed,
    hostname,
    memoryUsed,
    cached,
    swapTotal,
    swapUsed,
    memUsedRatio,
    diskUsage,
    diskUsed,
    readBytesPerSec,
    writeBytesPerSec,
    rxBytesPerSec,
    txBytesPerSec,
    processes,
    alerts,
  });

  return { ...base, health: computeHealth(base) };
}

interface SnapshotParts {
  cpuUsage: number;
  perCore: number[];
  cores: number;
  random: () => number;
  elapsed: number;
  hostname: string;
  memoryUsed: number;
  cached: number;
  swapTotal: number;
  swapUsed: number;
  memUsedRatio: number;
  diskUsage: number;
  diskUsed: number;
  readBytesPerSec: number;
  writeBytesPerSec: number;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  processes: ProcessInfo[];
  alerts: AlertInfo[];
}

/** Assembles the snapshot body shared by the mock generator and the mock server. */
function buildSnapshotBase(parts: SnapshotParts): Omit<WidgetSnapshot, 'health'> {
  const {
    cpuUsage,
    perCore,
    cores,
    random,
    elapsed,
    hostname,
    memoryUsed,
    cached,
    swapTotal,
    swapUsed,
    memUsedRatio,
    diskUsage,
    diskUsed,
    readBytesPerSec,
    writeBytesPerSec,
    rxBytesPerSec,
    txBytesPerSec,
    processes,
    alerts,
  } = parts;

  const load = (factor: number) => Number(((cpuUsage / 100) * cores * factor).toFixed(2));

  return {
    timestamp: Date.now(),
    host: {
      name: hostname,
      os: 'Ubuntu 24.04 LTS',
      platform: 'linux',
      uptime: Math.round(elapsed + 86400 * 18 + 3600 * 4),
      ip: '10.24.8.11',
      region: 'eu-central-1',
      kernel: '6.8.0-45-generic',
    },
    cpu: {
      usage: Number(cpuUsage.toFixed(1)),
      perCore: perCore.map((v) => Number(v.toFixed(1))),
      load: [load(0.9 + random() * 0.2), load(0.85 + random() * 0.2), load(0.8 + random() * 0.2)],
      cores,
      model: 'AMD EPYC 7B13',
      temperature: Number((42 + cpuUsage * 0.4 + random() * 3).toFixed(1)),
      breakdown: {
        user: Number((cpuUsage * 0.62).toFixed(1)),
        system: Number((cpuUsage * 0.24).toFixed(1)),
        iowait: Number((cpuUsage * 0.06).toFixed(1)),
        idle: Number((100 - cpuUsage).toFixed(1)),
      },
    },
    memory: {
      total: TOTAL_MEMORY,
      used: memoryUsed,
      free: TOTAL_MEMORY - memoryUsed,
      cached,
      swapTotal,
      swapUsed,
      usage: Number((memUsedRatio * 100).toFixed(1)),
    },
    disk: {
      total: TOTAL_DISK,
      used: diskUsed,
      free: TOTAL_DISK - diskUsed,
      usage: Number(diskUsage.toFixed(1)),
      readBytesPerSec,
      writeBytesPerSec,
      partitions: [
        {
          name: '/',
          total: TOTAL_DISK,
          used: diskUsed,
          free: TOTAL_DISK - diskUsed,
          usage: Number(diskUsage.toFixed(1)),
          status: diskUsage >= 90 ? 'critical' : diskUsage >= 80 ? 'warning' : 'ok',
        },
        partition('/var/log', 200 * 1024 ** 3, 54),
        partition('/data', 4 * 1024 ** 4, 71),
      ],
    },
    network: {
      rxBytesPerSec,
      txBytesPerSec,
      rxTotal: 8.4 * 1024 ** 4,
      txTotal: 5.1 * 1024 ** 4,
      latencyMs: Number((18 + wave(elapsed, 21) * 46 + random() * 8).toFixed(1)),
      packetLoss: Number((random() * 0.4).toFixed(2)),
      interfaces: [
        { name: 'eth0', rxBytesPerSec, txBytesPerSec, rxTotal: 8.4 * 1024 ** 4, txTotal: 5.1 * 1024 ** 4 },
        {
          name: 'wg0',
          rxBytesPerSec: Math.round(rxBytesPerSec * 0.18),
          txBytesPerSec: Math.round(txBytesPerSec * 0.22),
          rxTotal: 0.9 * 1024 ** 4,
          txTotal: 0.6 * 1024 ** 4,
        },
      ],
    },
    processes,
    alerts,
  };
}

/** Small helper so the partition list stays readable. */
function partition(name: string, total: number, usage: number) {
  const used = Math.round(total * (usage / 100));
  return {
    name,
    total,
    used,
    free: total - used,
    usage,
    status: usage >= 90 ? ('critical' as const) : usage >= 80 ? ('warning' as const) : ('ok' as const),
  };
}



/** Derives alerts from the synthetic readings so the badge is never empty by accident. */
function buildAlerts(cpuUsage: number, memUsedRatio: number, diskUsage: number): AlertInfo[] {
  const alerts: AlertInfo[] = [];
  const now = Date.now();
  if (diskUsage >= 80) {
    alerts.push({
      id: 'disk-pressure',
      title: 'Disk usage high',
      severity: diskUsage >= 90 ? 'critical' : 'warning',
      metric: 'disk',
      value: Number(diskUsage.toFixed(1)),
      message: `Root filesystem at ${diskUsage.toFixed(1)}%`,
      since: now - 1000 * 60 * 42,
    });
  }
  if (cpuUsage >= 85) {
    alerts.push({
      id: 'cpu-spike',
      title: 'CPU saturation',
      severity: 'critical',
      metric: 'cpu',
      value: Number(cpuUsage.toFixed(1)),
      message: 'Sustained CPU utilisation above 85%',
      since: now - 1000 * 60 * 6,
    });
  }
  if (memUsedRatio >= 0.85) {
    alerts.push({
      id: 'memory-pressure',
      title: 'Memory pressure',
      severity: 'warning',
      metric: 'memory',
      value: Number((memUsedRatio * 100).toFixed(1)),
      message: 'Reclaimable memory below comfort margin',
      since: now - 1000 * 60 * 12,
    });
  }
  return alerts;
}

/** Totals reported by the mock generator (exported for tests). */
export const mockTotals = { memory: TOTAL_MEMORY, disk: TOTAL_DISK };

export { swapUsagePercent };
