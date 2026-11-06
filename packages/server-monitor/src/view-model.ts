import {
  classify,
  formatBytes,
  formatLatency,
  formatPercent,
  formatRate,
  formatUptime,
  swapUsagePercent,
  withAlpha,
  type MetricHistory,
  type StatusLevel,
  type ThemeTokens,
  type ThresholdConfig,
  type TimeSeriesPoint,
  type Translator,
  type WidgetSnapshot,
} from '@widgets/core';
import type { SectionId } from './layout';

/**
 * Presentation model.
 *
 * The renderer never reads raw metrics: `buildViewModel` turns a snapshot plus
 * history into exactly the values, labels, colours and statuses every section
 * draws. Keeping this step pure means the whole visual mapping is unit testable
 * without a canvas.
 */

export interface GaugeItem {
  id: 'cpu' | 'memory' | 'disk';
  index: string;
  label: string;
  caption: string;
  value: number;
  valueLabel: string;
  status: StatusLevel;
  color: string;
}

export interface DonutSegment {
  value: number;
  label: string;
  color: string;
  /** Share of the total, 0..100 — used by tooltips. */
  percent: number;
}

export interface DonutItem {
  id: 'memory' | 'disk' | 'swap';
  label: string;
  caption: string;
  centerTop: string;
  centerBottom: string;
  status: StatusLevel;
  segments: DonutSegment[];
}

export interface BarItem {
  label: string;
  value: number;
  status: StatusLevel;
  tooltip: string;
}

export interface ProgressItem {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  status: StatusLevel;
  color: string;
}

export interface DualBarItem {
  id: string;
  label: string;
  primaryLabel: string;
  primary: number;
  secondaryLabel?: string;
  secondary?: number;
  status: StatusLevel;
  /** Primary segment colour, resolved from the theme accents. */
  color?: string;
}

export interface BadgeItem {
  id: string;
  index: string;
  value: string;
  label: string;
  status: StatusLevel;
}

export interface IconAction {
  id: string;
  label: string;
  icon: 'settings' | 'logs' | 'share' | 'network' | 'location' | 'link';
}

export interface SeriesItem {
  id: string;
  label: string;
  color: string;
  points: TimeSeriesPoint[];
  valueLabel: string;
}

export interface ViewModel {
  host: {
    name: string;
    os: string;
    ip: string;
    region: string;
    uptimeLabel: string;
    initials: string;
    avatarUrl?: string;
  };
  status: StatusLevel;
  alertCount: number;
  alerts: Array<{ id: string; title: string; severity: string; message?: string }>;
  gauges: GaugeItem[];
  donuts: DonutItem[];
  cpuBars: { items: BarItem[]; max: number; unit: string; cores: number };
  network: {
    series: SeriesItem[];
    ticks: number[];
    max: number;
    latencyLabel: string;
    summary: string;
  };
  score: { health: number; grade: string; processes: number; uptime: number; label: string };
  hostBars: ProgressItem[];
  details: Array<{ label: string; value: string }>;
  badges: BadgeItem[];
  resourceBars: ProgressItem[];
  dualBars: DualBarItem[];
  actions: IconAction[];
  updatedLabel: string;
  connection: { state: string; label: string; description: string };
  /** Sections the host explicitly disabled. */
  hidden: ReadonlySet<SectionId>;
  /** True while there is no snapshot yet. */
  pending: boolean;
}

export interface ViewModelInput {
  snapshot: WidgetSnapshot | null;
  history: MetricHistory;
  theme: ThemeTokens;
  thresholds: ThresholdConfig;
  t: Translator;
  connectionState?: string;
  hiddenSections?: Partial<Record<SectionId, boolean>>;
  now?: number;
}

const ACTION_ICONS: ReadonlyArray<IconAction> = [
  { id: 'settings', label: 'action.settings', icon: 'settings' },
  { id: 'logs', label: 'action.logs', icon: 'logs' },
  { id: 'share', label: 'action.share', icon: 'share' },
  { id: 'network', label: 'action.network', icon: 'network' },
  { id: 'location', label: 'action.location', icon: 'location' },
  { id: 'link', label: 'action.link', icon: 'link' },
];

/** Builds the full presentation model for one frame. */
export function buildViewModel(input: ViewModelInput): ViewModel {
  const { snapshot, history, theme, thresholds, t } = input;
  const hidden = hiddenSections(input.hiddenSections);

  if (!snapshot) {
    return emptyViewModel(theme, t, hidden, input.connectionState ?? 'connecting');
  }

  const cpuStatus = classify(snapshot.cpu.usage, thresholds.cpu);
  const memoryStatus = classify(snapshot.memory.usage, thresholds.memory);
  const diskStatus = classify(snapshot.disk.usage, thresholds.disk);
  const swapPercent = swapUsagePercent(snapshot.memory.swapUsed, snapshot.memory.swapTotal);
  const swapStatus = classify(swapPercent, thresholds.swap);
  const status = worstOf([cpuStatus, memoryStatus, diskStatus, swapStatus]);

  const cpuColor = theme.accents[0]!;
  const memoryColor = theme.accents[1]!;
  const diskColor = theme.accents[2]!;

  return {
    host: {
      name: snapshot.host.name,
      os: snapshot.host.os,
      ip: snapshot.host.ip ?? '—',
      region: snapshot.host.region ?? '—',
      uptimeLabel: formatUptime(snapshot.host.uptime),
      initials: initialsOf(snapshot.host.name),
      ...(snapshot.host.avatarUrl ? { avatarUrl: snapshot.host.avatarUrl } : {}),
    },
    status,
    alertCount: snapshot.alerts.length,
    alerts: snapshot.alerts.map((alert) => ({
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      ...(alert.message ? { message: alert.message } : {}),
    })),
    gauges: gauges(snapshot, t, thresholds, cpuColor, memoryColor, diskColor),
    donuts: donuts(snapshot, t, theme, swapPercent, swapStatus),
    cpuBars: {
      items: snapshot.cpu.perCore.slice(0, 16).map((value, index) => ({
        label: String(index + 1).padStart(2, '0'),
        value,
        status: classify(value, thresholds.cpu),
        tooltip: `${t('metric.cpu')} ${index + 1} · ${formatPercent(value)}`,
      })),
      max: 100,
      unit: '%',
      cores: snapshot.cpu.cores,
    },
    network: networkModel(snapshot, history, theme, t, thresholds),
    score: {
      health: snapshot.health.score,
      grade: snapshot.health.grade,
      processes: snapshot.processes.length,
      uptime: Math.min(100, Math.round((snapshot.host.uptime / (86400 * 365)) * 100)),
      label: snapshot.health.label,
    },
    hostBars: hostBars(snapshot, t, thresholds, cpuColor, memoryColor),
    details: [
      { label: 'OS', value: snapshot.host.os },
      { label: 'IP', value: snapshot.host.ip ?? '—' },
      { label: 'Region', value: snapshot.host.region ?? '—' },
      { label: t('metric.latency'), value: formatLatency(snapshot.network.latencyMs) },
    ],
    badges: [
      { id: 'cpu', index: '01', value: formatPercent(snapshot.cpu.usage, 0), label: t('metric.cpu'), status: cpuStatus },
      { id: 'memory', index: '02', value: formatPercent(snapshot.memory.usage, 0), label: t('metric.memory'), status: memoryStatus },
      { id: 'disk', index: '03', value: formatPercent(snapshot.disk.usage, 0), label: t('metric.disk'), status: diskStatus },
    ],
    resourceBars: topProcessBars(snapshot, t),
    dualBars: dualBars(snapshot, t, cpuColor, memoryColor, diskColor),
    actions: ACTION_ICONS.map((action) => ({ ...action, label: t(action.label as never) })),
    updatedLabel: `${t('status.updated')} ${new Date(snapshot.timestamp).toLocaleTimeString()}`,
    connection: connectionModel(t, input.connectionState ?? 'idle', snapshot.timestamp, input.now),
    hidden,
    pending: false,
  };
}

function hiddenSections(sections?: Partial<Record<SectionId, boolean>>): ReadonlySet<SectionId> {
  return new Set<SectionId>(
    Object.entries(sections ?? {})
      .filter(([, enabled]) => enabled === false)
      .map(([id]) => id as SectionId),
  );
}

function gauge(
  id: GaugeItem['id'],
  index: string,
  t: Translator,
  value: number,
  status: StatusLevel,
  color: string,
): GaugeItem {
  return {
    id,
    index,
    label: t(`metric.${id}` as never),
    caption: `${t(`metric.${id}` as never)} · ${formatPercent(value)}`,
    value,
    valueLabel: formatPercent(value, 0),
    status,
    color,
  };
}


function donuts(
  snapshot: WidgetSnapshot,
  t: Translator,
  theme: ThemeTokens,
  swapPercent: number,
  swapStatus: StatusLevel,
): DonutItem[] {
  const { memory, disk, network } = snapshot;
  const memoryColor = theme.accents[1]!;
  const diskColor = theme.accents[2]!;
  const rootPartition = disk.partitions.find((part) => part.name === '/') ?? disk.partitions[0];

  return [
    {
      id: 'memory',
      label: t('panel.memory.title'),
      caption: t('panel.memory.caption'),
      centerTop: formatPercent(memory.usage, 0),
      centerBottom: formatBytes(memory.total),
      status: classify(memory.usage, { warning: 80, critical: 92 }),
      segments: [
        {
          value: Math.max(0, memory.used - (memory.cached ?? 0)),
          label: t('metric.used'),
          color: memoryColor,
          percent: percentOf(memory.used - (memory.cached ?? 0), memory.total),
        },
        {
          value: memory.cached ?? 0,
          label: 'cache',
          color: withAlpha(memoryColor, 0.45),
          percent: percentOf(memory.cached ?? 0, memory.total),
        },
        {
          value: memory.free,
          label: t('metric.free'),
          color: theme.track,
          percent: percentOf(memory.free, memory.total),
        },
      ],
    },
    {
      id: 'disk',
      label: t('panel.disk.title'),
      caption: t('panel.disk.caption'),
      centerTop: formatPercent(disk.usage, 0),
      centerBottom: formatBytes(disk.total),
      status: classify(disk.usage, { warning: 80, critical: 90 }),
      segments: disk.partitions.slice(0, 3).map((part, index) => ({
        value: part.used,
        label: part.name,
        color: index === 0 ? diskColor : withAlpha(diskColor, 0.62 - index * 0.18),
        percent: percentOf(part.used, rootPartition?.total ?? disk.total),
      })),
    },
    {
      id: 'swap',
      label: t('panel.swap.title'),
      caption: t('panel.swap.caption'),
      centerTop: formatPercent(swapPercent, 0),
      centerBottom: formatRate(network.rxBytesPerSec + network.txBytesPerSec),
      status: swapStatus,
      segments: [
        {
          value: memory.swapUsed,
          label: t('metric.used'),
          color: theme.accents[0]!,
          percent: percentOf(memory.swapUsed, memory.swapTotal),
        },
        {
          value: Math.max(0, memory.swapTotal - memory.swapUsed),
          label: t('metric.free'),
          color: theme.track,
          percent: percentOf(memory.swapTotal - memory.swapUsed, memory.swapTotal),
        },
      ],
    },
  ];
}

function hostBars(
  snapshot: WidgetSnapshot,
  t: Translator,
  thresholds: ThresholdConfig,
  cpuColor: string,
  memoryColor: string,
): ProgressItem[] {
  const loadRatio = snapshot.cpu.load[0] / Math.max(1, snapshot.cpu.cores);
  return [
    {
      id: 'load',
      label: t('metric.load'),
      value: Math.min(100, loadRatio * 100),
      valueLabel: snapshot.cpu.load[0].toFixed(2),
      status: loadRatio >= thresholds.cpu.critical / 100 ? 'critical' : loadRatio >= thresholds.cpu.warning / 100 * 0.75 ? 'warning' : 'ok',
      color: cpuColor,
    },
    {
      id: 'memory',
      label: t('metric.memory'),
      value: snapshot.memory.usage,
      valueLabel: formatPercent(snapshot.memory.usage),
      status: classify(snapshot.memory.usage, thresholds.memory),
      color: memoryColor,
    },
  ];
}

function topProcessBars(snapshot: WidgetSnapshot, t: Translator): ProgressItem[] {
  const top = [...snapshot.processes].sort((a, b) => b.cpu - a.cpu).slice(0, 3);
  return top.map((process) => ({
    id: `proc-${process.pid}`,
    label: `${process.name} · ${process.pid}`,
    value: Math.min(100, process.cpu),
    valueLabel: formatPercent(process.cpu, 0),
    status: process.cpu >= 80 ? 'critical' : process.cpu >= 50 ? 'warning' : 'ok',
    color: process.cpu >= 80 ? '#e94b5c' : process.cpu >= 50 ? '#f5a524' : '#2f7bf6',
  }));
}


function dualBars(
  snapshot: WidgetSnapshot,
  t: Translator,
  cpuColor: string,
  memoryColor: string,
  diskColor: string,
): DualBarItem[] {
  const breakdown = snapshot.cpu.breakdown;
  const memTotal = Math.max(1, snapshot.memory.total);
  const diskRateMax = Math.max(
    1,
    snapshot.disk.readBytesPerSec + snapshot.disk.writeBytesPerSec,
  );

  return [
    {
      id: 'cpu-split',
      label: `${t('metric.cpu')} · user / system`,
      primaryLabel: 'user',
      primary: breakdown ? breakdown.user : snapshot.cpu.usage * 0.7,
      secondaryLabel: 'system',
      secondary: breakdown ? breakdown.system : snapshot.cpu.usage * 0.3,
      status: classify(snapshot.cpu.usage, { warning: 70, critical: 90 }),
    },
    {
      id: 'memory-split',
      label: `${t('metric.memory')} · ${t('metric.used')} / cache`,
      primaryLabel: t('metric.used'),
      primary: ((snapshot.memory.used - (snapshot.memory.cached ?? 0)) / memTotal) * 100,
      secondaryLabel: 'cache',
      secondary: ((snapshot.memory.cached ?? 0) / memTotal) * 100,
      status: classify(snapshot.memory.usage, { warning: 80, critical: 92 }),
    },
    {
      id: 'disk-io',
      label: `${t('panel.disk.title')} · R / W`,
      primaryLabel: 'read',
      primary: (snapshot.disk.readBytesPerSec / diskRateMax) * 100,
      secondaryLabel: 'write',
      secondary: (snapshot.disk.writeBytesPerSec / diskRateMax) * 100,
      status: classify(snapshot.disk.usage, { warning: 80, critical: 90 }),
    },
  ].map((item, index) => ({ ...item, color: [cpuColor, memoryColor, diskColor][index] ?? cpuColor }));
}

function networkModel(
  snapshot: WidgetSnapshot,
  history: MetricHistory,
  theme: ThemeTokens,
  t: Translator,
  thresholds: ThresholdConfig,
): ViewModel['network'] {
  const rxFallback: TimeSeriesPoint[] = [
    { t: snapshot.timestamp - 1000, v: snapshot.network.rxBytesPerSec },
    { t: snapshot.timestamp, v: snapshot.network.rxBytesPerSec },
  ];
  const txFallback: TimeSeriesPoint[] = [
    { t: snapshot.timestamp - 1000, v: snapshot.network.txBytesPerSec },
    { t: snapshot.timestamp, v: snapshot.network.txBytesPerSec },
  ];
  const rx = history.networkRx.length > 1 ? history.networkRx : rxFallback;
  const tx = history.networkTx.length > 1 ? history.networkTx : txFallback;
  const peak = Math.max(
    1,
    ...rx.map((p) => p.v),
    ...tx.map((p) => p.v),
  );
  const latencyStatus = classify(snapshot.network.latencyMs ?? 0, thresholds.latency);

  return {
    series: [
      {
        id: 'rx',
        label: t('panel.network.received'),
        color: theme.areaStroke,
        points: rx,
        valueLabel: formatRate(snapshot.network.rxBytesPerSec),
      },
      {
        id: 'tx',
        label: t('panel.network.sent'),
        color: theme.accents[0]!,
        points: tx,
        valueLabel: formatRate(snapshot.network.txBytesPerSec),
      },
    ],
    ticks: niceAxisTicks(peak),
    max: niceAxisMax(peak),
    latencyLabel: `${t('metric.latency')} ${formatLatency(snapshot.network.latencyMs)}${
      latencyStatus === 'ok' ? '' : ` · ${latencyStatus}`
    }`,
    summary: `${t('panel.network.received')} ${formatRate(snapshot.network.rxBytesPerSec)} · ${t('panel.network.sent')} ${formatRate(snapshot.network.txBytesPerSec)}`,
  };
}

/** Rounds a throughput peak up to a readable axis maximum. */
function niceAxisMax(peak: number): number {
  if (peak <= 0) return 1;
  const exponent = Math.floor(Math.log10(peak));
  const magnitude = 10 ** exponent;
  const normalized = peak / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function niceAxisTicks(peak: number, count = 4): number[] {
  const max = niceAxisMax(peak);
  return Array.from({ length: count + 1 }, (_, index) => (max / count) * index);
}


function gauges(
  snapshot: WidgetSnapshot,
  t: Translator,
  thresholds: ThresholdConfig,
  cpuColor: string,
  memoryColor: string,
  diskColor: string,
): GaugeItem[] {
  return [
    gauge('cpu', '01', t, snapshot.cpu.usage, classify(snapshot.cpu.usage, thresholds.cpu), cpuColor),
    gauge('memory', '02', t, snapshot.memory.usage, classify(snapshot.memory.usage, thresholds.memory), memoryColor),
    gauge('disk', '03', t, snapshot.disk.usage, classify(snapshot.disk.usage, thresholds.disk), diskColor),
  ];
}

/** Frame rendered before the first snapshot arrives (skeletons, never zeros). */
function emptyViewModel(
  theme: ThemeTokens,
  t: Translator,
  hidden: ReadonlySet<SectionId>,
  connectionState: string,
): ViewModel {
  return {
    host: {
      name: t('status.no-data'),
      os: '—',
      ip: '—',
      region: '—',
      uptimeLabel: '—',
      initials: '··',
    },
    status: 'unknown',
    alertCount: 0,
    alerts: [],
    gauges: ([
      ['cpu', '01'],
      ['memory', '02'],
      ['disk', '03'],
    ] as const).map(([id, index], i) =>
      gauge(id, index, t, 0, 'unknown', theme.accents[i] ?? theme.textFaint),
    ),
    donuts: (['memory', 'disk', 'swap'] as const).map((id) => ({
      id,
      label: t(`panel.${id}.title` as never),
      caption: '',
      centerTop: '—',
      centerBottom: '—',
      status: 'unknown' as StatusLevel,
      segments: [{ value: 1, label: '—', color: theme.track, percent: 100 }],
    })),
    cpuBars: { items: [], max: 100, unit: '%', cores: 0 },
    network: { series: [], ticks: [0, 1], max: 1, latencyLabel: '—', summary: '—' },
    score: { health: 0, grade: '—', processes: 0, uptime: 0, label: '—' },
    hostBars: [],
    details: [],
    badges: (['01', '02', '03'] as const).map((index, i) => ({
      id: `pending-${index}`,
      index,
      value: '—',
      label: t(['metric.cpu', 'metric.memory', 'metric.disk'][i] as never),
      status: 'unknown' as StatusLevel,
    })),
    resourceBars: [],
    dualBars: [],
    actions: ACTION_ICONS.map((action) => ({ ...action, label: t(action.label as never) })),
    updatedLabel: '—',
    connection: connectionModel(t, connectionState, 0, undefined),
    hidden,
    pending: true,
  };
}

function worstOf(statuses: StatusLevel[]): StatusLevel {
  const rank: Record<StatusLevel, number> = { unknown: -1, ok: 0, warning: 1, critical: 2 };
  return statuses.reduce<StatusLevel>((worst, status) => (rank[status] > rank[worst] ? status : worst), 'unknown');
}

function percentOf(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}._-]+/gu, ' ').trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function connectionModel(
  t: Translator,
  state: string,
  timestamp: number,
  now: number | undefined,
): ViewModel['connection'] {
  const age = timestamp > 0 ? Math.max(0, Math.round(((now ?? Date.now()) - timestamp) / 1000)) : -1;
  const description = age < 0 ? t('status.no-data') : `${t('status.updated')} ${age}s`;
  const label =
    state === 'live'
      ? t('status.live')
      : state === 'reconnecting'
        ? t('status.reconnecting')
        : state === 'error'
          ? t('status.error')
          : state === 'closed'
            ? t('status.closed')
            : state === 'idle'
              ? t('status.idle')
              : t('status.connecting');
  return { state, label, description };
}

