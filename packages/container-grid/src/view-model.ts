import {
  formatBytes,
  formatPercent,
  formatUptime,
  type ContainerFilter,
  type ContainerHealth,
  type ContainerInfo,
  type ContainerPhase,
  type ContainerStore,
  type ContainerStats,
  type ThemeTokens,
  type Translator,
} from '@widgets/core';

/**
 * Presentation model for the container grid.
 *
 * Pure: the renderer draws this model, never the store. That keeps the card
 * layout, colours, rollups and detail rows unit-testable without a canvas.
 */

export interface GridCounter {
  id: string;
  label: string;
  value: string;
  tone: 'neutral' | 'ok' | 'warning' | 'critical';
}

export interface GridAction {
  id: 'attention' | 'refresh' | 'reset' | 'copy';
  label: string;
  active: boolean;
  disabled: boolean;
}

export interface PhaseChip {
  phase: ContainerPhase | 'all';
  label: string;
  count: number;
  active: boolean;
  color: string;
}

export interface NamespaceChip {
  namespace: string;
  count: number;
  critical: number;
  active: boolean;
  color: string;
}

export interface ContainerCard {
  id: string;
  index: number;
  name: string;
  namespace: string;
  workload?: string;
  workloadKind?: string;
  phase: ContainerPhase;
  health: ContainerHealth;
  statusLabel: string;
  statusColor: string;
  /** Short reason/message shown when the pod is not healthy. */
  note?: string;
  node?: string;
  ageLabel: string;
  image: string;
  imageTag: string;
  readyLabel: string;
  ready: boolean;
  restarts: number;
  restartsLabel: string;
  cpu: { used: number; limit: number; percent: number; label: string; valueLabel: string };
  memory: { used: number; limit: number; percent: number; label: string; valueLabel: string };
  /** CPU sparkline samples in "display units" (0..100 of the limit). */
  spark: number[];
  selected: boolean;
  /** True when the card is wide enough for the sparkline + image row. */
  compact: boolean;
}

export interface CapacityMetric {
  id: 'cpu' | 'memory';
  label: string;
  usedLabel: string;
  limitLabel: string;
  percent: number;
  color: string;
  tone: 'ok' | 'warning' | 'critical';
  /** Top consumers of this metric, for the ranked list. */
  consumers: Array<{ id: string; name: string; label: string; percent: number; color: string; health: ContainerHealth }>;
}

export interface NamespaceRow {
  namespace: string;
  count: number;
  critical: number;
  percent: number;
  color: string;
}

export interface ContainerDetail {
  container: ContainerInfo | null;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusColor: string;
  rows: Array<{ label: string; value: string }>;
  labels: Array<{ label: string; value: string }>;
  spark: number[];
}

export interface ContainerGridViewModel {
  toolbar: {
    title: string;
    subtitle: string;
    connection: { state: string; label: string; description: string };
    counters: GridCounter[];
    actions: GridAction[];
  };
  filters: {
    phases: PhaseChip[];
    namespaces: NamespaceChip[];
    query: string;
    activeCount: number;
    attentionOnly: boolean;
  };
  cards: {
    items: ContainerCard[];
    total: number;
    windowSize: number;
    filteredTotal: number;
    scrollTop: number;
    pending: boolean;
    pendingLabel: string;
    emptyLabel: string;
    label: string;
  };
  capacity: CapacityMetric[];
  namespaces: NamespaceRow[];
  detail: ContainerDetail;
  hidden: ReadonlySet<string>;
}

export function buildContainerGridViewModel(input: ContainerGridViewModelInput): ContainerGridViewModel {
  const { store, theme, t, filters, columns, cardWidth } = input;
  const hidden = hiddenSections(input.hiddenSections);
  const stats = store.stats();
  const filtered = sortContainers(store.filtered(filters), input.sort ?? 'severity');
  const first = Math.max(0, Math.min(input.first, Math.max(0, filtered.length - 1)));
  const window = filtered.slice(first, first + Math.max(0, input.count));
  const now = input.now ?? Date.now();
  const compact = cardWidth < 250;

  const cards: ContainerCard[] = window.map((container, index) => toCard(container, theme, first + index, input.selectionId, compact, now));

  return {
    toolbar: {
      title: t('grid.title'),
      subtitle: t('grid.subtitle'),
      connection: connectionModel(t, input.connectionState ?? 'idle'),
      counters: counters(t, stats),
      actions: actions(t, input.filters),
    },
    filters: {
      phases: phaseChips(t, filters, stats),
      namespaces: namespaceChips(filters, stats, theme),
      query: filters.query,
      activeCount:
        (filters.phases.length > 0 ? 1 : 0) + (filters.namespaces.length > 0 ? 1 : 0) + (filters.query ? 1 : 0) + (filters.attentionOnly ? 1 : 0),
      attentionOnly: filters.attentionOnly ?? false,
    },
    cards: {
      items: cards,
      total: cards.length,
      windowSize: cards.length,
      filteredTotal: filtered.length,
      scrollTop: input.scrollTop,
      pending: stats.total === 0,
      pendingLabel: t('status.connecting'),
      emptyLabel: t('grid.empty'),
      label: `${filtered.length} / ${stats.total} ${t('grid.containers')}`,
    },
    capacity: capacity(stats, store, theme, t),
    namespaces: namespaceRows(stats, theme),
    detail: detail(t, store, input.selectionId, theme, now),
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

/** Applies the configured ordering on top of the store's severity-first order. */
export function sortContainers(
  containers: readonly ContainerInfo[],
  sort: 'severity' | 'name' | 'restarts' | 'cpu' | 'memory',
): ContainerInfo[] {
  const copy = [...containers];
  switch (sort) {
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'restarts':
      return copy.sort((a, b) => b.spec.restarts - a.spec.restarts);
    case 'cpu':
      return copy.sort((a, b) => b.cpu.used - a.cpu.used);
    case 'memory':
      return copy.sort((a, b) => b.memory.used - a.memory.used);
    default:
      return copy;
  }
}

function toCard(
  container: ContainerInfo,
  theme: ThemeTokens,
  index: number,
  selectionId: string | null,
  compact: boolean,
  now: number,
): ContainerCard {
  const history = container.cpuHistory ?? [];
  const spark = history.map((value) => (container.cpu.limit ? Math.min(100, (value / container.cpu.limit) * 100) : 0));
  const note = container.message ?? container.spec.lastReason;

  return {
    id: container.id,
    index,
    name: container.name,
    namespace: container.namespace,
    ...(container.workload ? { workload: container.workload } : {}),
    ...(container.workloadKind ? { workloadKind: container.workloadKind } : {}),
    phase: container.phase,
    health: container.health,
    statusLabel: PHASE_LABELS[container.phase],
    statusColor: theme.status[container.health] ?? theme.status.unknown,
    ...(note ? { note } : {}),
    ...(container.node ? { node: container.node } : {}),
    ageLabel: container.startedAt ? formatUptime(Math.max(0, (now - container.startedAt) / 1000)) : '—',
    image: container.spec.image,
    imageTag: container.spec.image.split(':')[1] ?? 'latest',
    readyLabel: `${container.spec.readyContainers}/${container.spec.totalContainers}`,
    ready: container.spec.readyContainers >= container.spec.totalContainers,
    restarts: container.spec.restarts,
    restartsLabel: container.spec.restarts > 0 ? `${container.spec.restarts} restarts` : 'no restarts',
    cpu: {
      used: container.cpu.used,
      limit: container.cpu.limit ?? 0,
      percent: container.cpu.percent ?? 0,
      label: 'CPU',
      valueLabel:
        container.cpu.limit && container.cpu.limit > 0
          ? `${container.cpu.used.toFixed(2)} / ${container.cpu.limit.toFixed(2)} cores`
          : `${container.cpu.used.toFixed(2)} cores`,
    },
    memory: {
      used: container.memory.used,
      limit: container.memory.limit ?? 0,
      percent: container.memory.percent ?? 0,
      label: 'MEM',
      valueLabel:
        container.memory.limit && container.memory.limit > 0
          ? `${formatBytes(container.memory.used)} / ${formatBytes(container.memory.limit)}`
          : formatBytes(container.memory.used),
    },
    spark,
    selected: container.id === selectionId,
    compact,
  };
}

export interface ContainerGridViewModelInput {
  store: ContainerStore;
  theme: ThemeTokens;
  t: Translator;
  filters: ContainerFilter;
  selectionId: string | null;
  scrollTop: number;
  /** First rendered card index (from `computeGridWindow`). */
  first: number;
  /** Number of cards to materialise. */
  count: number;
  columns: number;
  cardWidth: number;
  connectionState?: string;
  sort?: 'severity' | 'name' | 'restarts' | 'cpu' | 'memory';
  hiddenSections?: Partial<Record<string, boolean>>;
  now?: number;
}

const PHASE_LABELS: Record<ContainerPhase, string> = {
  running: 'Running',
  pending: 'Pending',
  succeeded: 'Succeeded',
  failed: 'Failed',
  unknown: 'Unknown',
};

function counters(t: Translator, stats: ContainerStats): GridCounter[] {
  const attention = stats.byHealth.critical + stats.byHealth.warning;
  return [
    { id: 'total', label: t('grid.containers'), value: String(stats.total), tone: 'neutral' },
    { id: 'running', label: 'running', value: String(stats.byPhase.running), tone: 'ok' },
    { id: 'attention', label: 'attention', value: String(attention), tone: attention > 0 ? 'warning' : 'ok' },
    { id: 'failed', label: 'failed', value: String(stats.byPhase.failed), tone: stats.byPhase.failed > 0 ? 'critical' : 'ok' },
    { id: 'restarts', label: 'restarts', value: String(stats.restarts), tone: stats.restarts > 0 ? 'warning' : 'ok' },
  ];
}

function actions(t: Translator, filters: ContainerFilter): GridAction[] {
  return [
    { id: 'attention', label: t('grid.attention'), active: filters.attentionOnly ?? false, disabled: false },
    { id: 'refresh', label: t('grid.refresh'), active: false, disabled: false },
    { id: 'reset', label: t('log.clear'), active: false, disabled: filters.phases.length === 0 && filters.namespaces.length === 0 && !filters.query },
    { id: 'copy', label: t('grid.copy'), active: false, disabled: false },
  ];
}

function phaseChips(t: Translator, filters: ContainerFilter, stats: ContainerStats): PhaseChip[] {
  const phases: Array<ContainerPhase> = ['running', 'pending', 'succeeded', 'failed'];
  const chips: PhaseChip[] = [
    {
      phase: 'all',
      label: t('log.all'),
      count: stats.total,
      active: filters.phases.length === 0,
      color: 'muted',
    },
  ];
  for (const phase of phases) {
    chips.push({
      phase,
      label: PHASE_LABELS[phase],
      count: stats.byPhase[phase],
      active: filters.phases.includes(phase),
      color: phase,
    });
  }
  return chips;
}

function namespaceChips(filters: ContainerFilter, stats: ContainerStats, theme: ThemeTokens): NamespaceChip[] {
  return stats.byNamespace.slice(0, 5).map((entry, index) => ({
    namespace: entry.namespace,
    count: entry.count,
    critical: entry.critical,
    active: filters.namespaces.includes(entry.namespace),
    color: theme.accents[index % theme.accents.length]!,
  }));
}

function capacity(stats: ContainerStats, store: ContainerStore, theme: ThemeTokens, t: Translator): CapacityMetric[] {
  const containerById = new Map(store.all().map((container) => [container.id, container]));
  const build = (
    id: 'cpu' | 'memory',
    label: string,
    used: number,
    limit: number,
    format: (value: number) => string,
    color: string,
  ): CapacityMetric => {
    const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    const consumers = [...store.all()]
      .sort((a, b) => (id === 'cpu' ? b.cpu.used - a.cpu.used : b.memory.used - a.memory.used))
      .slice(0, 5)
      .map((container) => {
        const raw = id === 'cpu' ? container.cpu : container.memory;
        return {
          id: container.id,
          name: container.name,
          label: format(raw.used),
          percent: raw.percent ?? (raw.limit ? Math.min(100, (raw.used / raw.limit) * 100) : 0),
          color: theme.status[container.health] ?? theme.status.unknown,
          health: container.health,
        };
      });
    void containerById;
    return {
      id,
      label,
      usedLabel: format(used),
      limitLabel: limit > 0 ? format(limit) : t('grid.noLimit'),
      percent,
      color,
      tone: percent >= 85 ? 'critical' : percent >= 70 ? 'warning' : 'ok',
      consumers,
    };
  };

  return [
    build('cpu', 'CPU', stats.cpuUsed, stats.cpuLimit, (value) => `${value.toFixed(2)} cores`, theme.accents[0]!),
    build(
      'memory',
      t('metric.memory'),
      stats.memoryUsed,
      stats.memoryLimit,
      (value) => formatBytes(value),
      theme.accents[1]!,
    ),
  ];
}

function namespaceRows(stats: ContainerStats, theme: ThemeTokens): NamespaceRow[] {
  const max = stats.byNamespace.reduce((peak, entry) => Math.max(peak, entry.count), 0) || 1;
  return stats.byNamespace.slice(0, 6).map((entry, index) => ({
    namespace: entry.namespace,
    count: entry.count,
    critical: entry.critical,
    percent: (entry.count / max) * 100,
    color: theme.accents[index % theme.accents.length]!,
  }));
}

function connectionModel(t: Translator, state: string): { state: string; label: string; description: string } {
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
  return { state, label, description: t('grid.subtitle') };
}

function detail(
  t: Translator,
  store: ContainerStore,
  selectionId: string | null,
  theme: ThemeTokens,
  now: number,
): ContainerDetail {
  const container = selectionId ? store.get(selectionId) ?? null : null;
  if (!container) {
    return {
      container: null,
      title: t('grid.detail'),
      subtitle: t('grid.detail.empty'),
      statusLabel: '—',
      statusColor: theme.textFaint,
      rows: [],
      labels: [],
      spark: [],
    };
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: 'phase', value: PHASE_LABELS[container.phase] },
    { label: 'health', value: container.health.toUpperCase() },
    { label: 'namespace', value: container.namespace },
  ];
  if (container.workload) rows.push({ label: 'workload', value: `${container.workload}${container.workloadKind ? ` (${container.workloadKind})` : ''}` });
  if (container.node) rows.push({ label: 'node', value: container.node });
  rows.push(
    { label: 'ready', value: `${container.spec.readyContainers}/${container.spec.totalContainers}` },
    { label: 'restarts', value: String(container.spec.restarts) },
    { label: 'image', value: container.spec.image },
    { label: 'age', value: container.startedAt ? formatUptime(Math.max(0, (now - container.startedAt) / 1000)) : '—' },
    { label: 'cpu', value: container.cpu.limit ? `${container.cpu.used.toFixed(2)} / ${container.cpu.limit.toFixed(2)} cores` : `${container.cpu.used.toFixed(2)} cores` },
    {
      label: 'memory',
      value: container.memory.limit
        ? `${formatBytes(container.memory.used)} / ${formatBytes(container.memory.limit)}`
        : formatBytes(container.memory.used),
    },
  );
  if (container.spec.lastReason) rows.push({ label: 'last', value: container.spec.lastReason });
  if (container.message) rows.push({ label: 'note', value: container.message });

  return {
    container,
    title: container.name,
    subtitle: `${container.namespace} · ${formatPercent(container.cpu.percent ?? 0, 0)} CPU`,
    statusLabel: PHASE_LABELS[container.phase],
    statusColor: theme.status[container.health] ?? theme.status.unknown,
    rows,
    labels: Object.entries(container.labels ?? {}).map(([label, value]) => ({ label, value })),
    spark: store.history(container.id),
  };
}

