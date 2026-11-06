import {
  LOG_LEVELS,
  LEVEL_SEVERITY,
  formatPercent,
  type LogBucket,
  type LogEntry,
  type LogFilter,
  type LogLevel,
  type LogStore,
  type LogStats,
  type ThemeTokens,
  type Translator,
} from '@widgets/core';

/**
 * Presentation model for the log stream widget.
 *
 * Pure: the renderer never reads the store directly, it draws this model. That
 * keeps the visual mapping (labels, colours, windowing, statistics) unit-testable
 * without a canvas.
 */

export interface LogToolbarCounter {
  id: string;
  label: string;
  value: string;
  /** Semantic tone used for the value colour. */
  tone: 'neutral' | 'ok' | 'warning' | 'critical';
}

export interface LogToolbarAction {
  id: 'follow' | 'clear' | 'copy' | 'top' | 'jump-latest';
  label: string;
  icon: 'settings' | 'logs' | 'share' | 'network' | 'location' | 'link';
  active: boolean;
  /** Disabled actions are drawn dimmed and produce no hit region. */
  disabled: boolean;
}

export interface LogLevelChip {
  /** `'all'` is the reset chip. */
  level: LogLevel | 'all';
  label: string;
  count: number;
  active: boolean;
  color: string;
}

export interface LogServiceChip {
  service: string;
  count: number;
  active: boolean;
  color: string;
}

export interface LogRow {
  id: string;
  index: number;
  level: LogLevel;
  color: string;
  timeLabel: string;
  service: string;
  message: string;
  repeat: number | null;
  selected: boolean;
  traceId?: string;
  host?: string;
}

export interface LogHistogram {
  buckets: LogBucket[];
  max: number;
  colors: Record<LogLevel, string>;
  /** Time span covered, for the axis label. */
  spanLabel: string;
}

export interface LogSeverityMix {
  segments: Array<{ level: LogLevel; count: number; color: string; percent: number }>;
  total: number;
  errorRate: number;
  errorRateLabel: string;
  tone: 'neutral' | 'ok' | 'warning' | 'critical';
}

export interface LogServiceBar {
  service: string;
  count: number;
  errorCount: number;
  /** Share of the buffered lines, 0..100. */
  percent: number;
  /** Share of the service's own lines that are errors, 0..100. */
  errorPercent: number;
  color: string;
  tone: 'neutral' | 'ok' | 'warning' | 'critical';
}

export interface LogDetail {
  entry: LogEntry | null;
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: string }>;
  attributes: Array<{ label: string; value: string }>;
}

export interface LogViewModel {
  toolbar: {
    title: string;
    subtitle: string;
    connection: { state: string; label: string; description: string };
    counters: LogToolbarCounter[];
    actions: LogToolbarAction[];
  };
  filters: {
    levels: LogLevelChip[];
    services: LogServiceChip[];
    query: string;
    activeCount: number;
  };
  stream: {
    rows: LogRow[];
    /** Number of rows materialised in this frame (viewport + overscan). */
    windowSize: number;
    first: number;
    offset: number;
    /** Total rows available after filtering (for the scrollbar). */
    filteredTotal: number;
    scrollTop: number;
    follow: boolean;
    rowHeight: number;
    pending: boolean;
    emptyMessage: string;
    label: string;
  };
  histogram: LogHistogram;
  severityMix: LogSeverityMix;
  services: LogServiceBar[];
  detail: LogDetail;
  hidden: ReadonlySet<string>;
}

export interface LogViewModelInput {
  store: LogStore;
  theme: ThemeTokens;
  t: Translator;
  filters: LogFilter;
  selectionId: string | null;
  scrollTop: number;
  follow: boolean;
  rowHeight: number;
  /** First visible row (from `computeStreamWindow`). */
  first: number;
  /** Number of rows to materialise. */
  count: number;
  connectionState?: string;
  hiddenSections?: Partial<Record<string, boolean>>;
  /** Accent order used for service colours. */
  now?: number;
}

/** Builds the full presentation model for one frame. */
export function buildLogViewModel(input: LogViewModelInput): LogViewModel {
  const { store, theme, t, filters } = input;
  const hidden = hiddenSections(input.hiddenSections);
  const stats = store.stats();
  const filtered = store.filtered(filters);
  const first = Math.max(0, Math.min(input.first, Math.max(0, filtered.length - 1)));
  const count = Math.max(0, input.count);
  const window = filtered.slice(first, first + count);
  const now = input.now ?? Date.now();

  const rows: LogRow[] = window.map((entry, index) => ({
    id: entry.id,
    index: first + index,
    level: entry.level,
    color: theme.levels[entry.level],
    timeLabel: timeLabel(entry.timestamp),
    service: entry.service,
    message: entry.message,
    repeat: entry.repeat && entry.repeat > 1 ? entry.repeat : null,
    selected: entry.id === input.selectionId,
    ...(entry.traceId ? { traceId: entry.traceId } : {}),
    ...(entry.host ? { host: entry.host } : {}),
  }));

  const selected = input.selectionId ? store.entries().find((entry) => entry.id === input.selectionId) ?? null : null;

  return {
    toolbar: {
      title: t('log.title'),
      subtitle: t('log.subtitle'),
      connection: connectionModel(t, input.connectionState ?? 'idle'),
      counters: counters(t, stats),
      actions: toolbarActions(t, input.follow, filtered.length, selected),
    },
    filters: {
      levels: levelChips(t, filters, stats, theme),
      services: serviceChips(filters, stats, theme),
      query: filters.query,
      activeCount: (filters.levels.length > 0 ? 1 : 0) + (filters.services.length > 0 ? 1 : 0) + (filters.query ? 1 : 0),
    },
    stream: {
      rows,
      windowSize: rows.length,
      first,
      offset: input.first * input.rowHeight - input.scrollTop,
      filteredTotal: filtered.length,
      scrollTop: input.scrollTop,
      follow: input.follow,
      rowHeight: input.rowHeight,
      pending: stats.received === 0,
      emptyMessage: stats.received === 0 ? t('log.waiting') : t('log.empty'),
      label: `${filtered.length} / ${stats.received} ${t('log.received')}`,
    },
    histogram: histogram(t, store, theme),
    severityMix: severityMix(t, stats, theme),
    services: serviceBars(stats, theme),
    detail: detail(t, selected, now),
    hidden,
  };
}

function hiddenSections(sections?: Partial<Record<string, boolean>>): ReadonlySet<string> {
  return new Set(
    Object.entries(sections ?? {})
      .filter(([, enabled]) => enabled === false)
      .map(([id]) => id),
  );
}

/** `HH:MM:SS.mmm` in local time. */
export function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Human relative time ("12s ago", "3m ago"). */
export function relativeLabel(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 1) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function counters(t: Translator, stats: LogStats): LogToolbarCounter[] {
  const errors = stats.byLevel.error + stats.byLevel.fatal;
  const tone: LogToolbarCounter['tone'] = stats.errorRate >= 1 ? 'critical' : stats.errorRate >= 0.1 ? 'warning' : 'ok';
  return [
    { id: 'received', label: t('log.received'), value: compact(stats.received), tone: 'neutral' },
    { id: 'buffered', label: t('log.buffered'), value: compact(stats.total), tone: 'neutral' },
    { id: 'errors', label: 'errors', value: compact(errors), tone: errors > 0 ? 'critical' : 'ok' },
    { id: 'rate', label: t('log.rate'), value: stats.errorRate.toFixed(stats.errorRate < 1 ? 2 : 1), tone },
  ];
}

function compact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function toolbarActions(
  t: Translator,
  follow: boolean,
  filteredTotal: number,
  selected: LogEntry | null,
): LogToolbarAction[] {
  return [
    {
      id: 'follow',
      label: follow ? t('log.pause') : t('log.resume'),
      icon: 'network',
      active: follow,
      disabled: false,
    },
    { id: 'jump-latest', label: t('log.follow'), icon: 'location', active: false, disabled: filteredTotal === 0 },
    { id: 'copy', label: t('log.copy'), icon: 'share', active: false, disabled: selected === null },
    { id: 'clear', label: t('log.clear'), icon: 'logs', active: false, disabled: false },
  ];
}


function levelChips(
  t: Translator,
  filters: LogFilter,
  stats: LogStats,
  theme: ThemeTokens,
): LogLevelChip[] {
  const minLevel = filters.minLevel && filters.minLevel !== 'all' ? filters.minLevel : null;
  const total = LOG_LEVELS.reduce((sum, level) => sum + stats.byLevel[level], 0);
  const chips: LogLevelChip[] = [
    {
      level: 'all',
      label: t('log.all'),
      count: total,
      active: filters.levels.length === 0 && minLevel === null,
      color: theme.textMuted,
    },
  ];
  for (const level of LOG_LEVELS) {
    chips.push({
      level,
      label: level,
      count: stats.byLevel[level],
      active: filters.levels.includes(level) || (minLevel !== null && LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[minLevel]),
      color: theme.levels[level],
    });
  }
  return chips;
}

function serviceChips(filters: LogFilter, stats: LogStats, theme: ThemeTokens): LogServiceChip[] {
  return stats.byService.slice(0, 6).map((stat, index) => ({
    service: stat.service,
    count: stat.count,
    active: filters.services.includes(stat.service),
    color: theme.accents[index % theme.accents.length]!,
  }));
}

function histogram(t: Translator, store: LogStore, theme: ThemeTokens): LogHistogram {
  const buckets = store.histogram();
  const max = buckets.reduce((peak, bucket) => Math.max(peak, bucket.total), 0) || 1;
  const seconds = Math.round((buckets.length * (buckets[1] ? buckets[1].t - buckets[0]!.t : 1000)) / 1000);
  return {
    buckets,
    max,
    colors: { ...theme.levels },
    spanLabel: `${seconds}s · ${t('log.volume')}`,
  };
}

function severityMix(t: Translator, stats: LogStats, theme: ThemeTokens): LogSeverityMix {
  const total = LOG_LEVELS.reduce((sum, level) => sum + stats.byLevel[level], 0);
  const segments = LOG_LEVELS.filter((level) => stats.byLevel[level] > 0).map((level) => ({
    level,
    count: stats.byLevel[level],
    color: theme.levels[level],
    percent: total > 0 ? (stats.byLevel[level] / total) * 100 : 0,
  }));
  const tone: LogSeverityMix['tone'] =
    stats.errorRate >= 1 ? 'critical' : stats.errorRate >= 0.1 ? 'warning' : 'ok';
  return {
    segments,
    total,
    errorRate: stats.errorRate,
    errorRateLabel: `${t('log.rate')} ${stats.errorRate.toFixed(2)}`,
    tone,
  };
}

function serviceBars(stats: LogStats, theme: ThemeTokens): LogServiceBar[] {
  const max = stats.byService.reduce((peak, stat) => Math.max(peak, stat.count), 0) || 1;
  return stats.byService.slice(0, 6).map((stat, index) => {
    const errorPercent = stat.count > 0 ? (stat.errorCount / stat.count) * 100 : 0;
    const tone: LogServiceBar['tone'] = errorPercent > 20 ? 'critical' : errorPercent > 5 ? 'warning' : 'ok';
    return {
      service: stat.service,
      count: stat.count,
      errorCount: stat.errorCount,
      percent: (stat.count / max) * 100,
      errorPercent,
      color: theme.accents[index % theme.accents.length]!,
      tone,
    };
  });
}

function detail(t: Translator, entry: LogEntry | null, now: number): LogDetail {
  if (!entry) {
    return { entry: null, title: t('log.detail'), subtitle: t('log.detail.empty'), rows: [], attributes: [] };
  }
  const rows: Array<{ label: string; value: string }> = [
    { label: 'level', value: entry.level.toUpperCase() },
    { label: 'service', value: entry.service },
    { label: 'time', value: `${timeLabel(entry.timestamp)} · ${relativeLabel(entry.timestamp, now)}` },
  ];
  if (entry.host) rows.push({ label: 'host', value: entry.host });
  if (entry.pid != null) rows.push({ label: 'pid', value: String(entry.pid) });
  if (entry.traceId) rows.push({ label: 'trace', value: entry.traceId });
  if (entry.repeat && entry.repeat > 1) {
    rows.push({ label: 'repeat', value: t('log.repeated', { count: entry.repeat }) });
  }

  return {
    entry,
    title: t('log.detail'),
    subtitle: `${entry.service} · ${relativeLabel(entry.timestamp, now)}`,
    rows,
    attributes: Object.entries(entry.attributes ?? {}).map(([label, value]) => ({
      label,
      value: value === null ? 'null' : String(value),
    })),
  };
}

function connectionModel(
  t: Translator,
  state: string,
): { state: string; label: string; description: string } {
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
  return { state, label, description: t('log.subtitle') };
}

