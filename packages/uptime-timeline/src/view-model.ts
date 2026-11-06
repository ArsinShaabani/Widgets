import {
  formatPercent,
  formatUptime,
  type IncidentSeverity,
  type ServiceState,
  type ThemeTokens,
  type Translator,
  type UptimeFilter,
  type UptimeIncident,
  type UptimeService,
  type UptimeStats,
  type UptimeStore,
} from '@widgets/core';

/**
 * Presentation model for the uptime timeline.
 *
 * Pure: the renderer draws this model, never the store, so the heatmap cells,
 * SLA rollups, incident rows and colours stay unit-testable without a canvas.
 */

export interface TimelineCounter {
  id: string;
  label: string;
  value: string;
  tone: 'neutral' | 'ok' | 'warning' | 'critical';
}

export interface TimelineAction {
  id: 'attention' | 'refresh' | 'copy';
  label: string;
  active: boolean;
  disabled: boolean;
}

export interface StateChip {
  state: ServiceState | 'all';
  label: string;
  count: number;
  active: boolean;
  color: string;
}

export interface GroupChip {
  group: string;
  count: number;
  impacted: number;
  active: boolean;
  color: string;
}

export interface TimelineCell {
  /** Day start, epoch ms. */
  day: number;
  state: ServiceState;
  color: string;
  /** Availability for that day, 0..100. */
  uptime: number;
  /** Incidents touching the day. */
  incidents: string[];
}

export interface TimelineRow {
  id: string;
  index: number;
  name: string;
  group: string;
  state: ServiceState;
  statusColor: string;
  uptimeLabel: string;
  sloLabel: string;
  /** True when availability is below the SLO target. */
  breached: boolean;
  errorBudgetUsed: number;
  budgetLabel: string;
  /** Daily cells, oldest first. */
  cells: TimelineCell[];
  /** Sparkline of daily availability (0..100). */
  spark: number[];
  activeIncidentId?: string;
  selected: boolean;
  /** Hide the group label on narrow rows. */
  compact: boolean;
}

export interface SloRow {
  id: string;
  name: string;
  uptimeLabel: string;
  targetLabel: string;
  uptimePercent: number;
  targetPercent: number;
  budgetUsed: number;
  budgetLabel: string;
  tone: 'ok' | 'warning' | 'critical';
  color: string;
}

export interface IncidentRow {
  id: string;
  title: string;
  severity: IncidentSeverity;
  severityLabel: string;
  color: string;
  state: string;
  stateLabel: string;
  open: boolean;
  /** `2h 18m` style duration (so far, when open). */
  durationLabel: string;
  ageLabel: string;
  servicesLabel: string;
  selected: boolean;
}

export interface TimelineDetail {
  kind: 'service' | 'incident' | 'none';
  title: string;
  subtitle: string;
  statusLabel: string;
  statusColor: string;
  rows: Array<{ label: string; value: string }>;
  updates: Array<{ at: string; state: string; message: string }>;
  /** Daily cells for the selected service. */
  cells: TimelineCell[];
}

export interface UptimeViewModel {
  toolbar: {
    title: string;
    subtitle: string;
    connection: { state: string; label: string; description: string };
    counters: TimelineCounter[];
    actions: TimelineAction[];
    summary: Array<{ label: string; value: string }>;
  };
  filters: {
    states: StateChip[];
    groups: GroupChip[];
    query: string;
    activeCount: number;
    attentionOnly: boolean;
  };
  timeline: {
    rows: TimelineRow[];
    total: number;
    windowSize: number;
    filteredTotal: number;
    scrollTop: number;
    days: number;
    monthLabels: Array<{ index: number; label: string }>;
    pending: boolean;
    pendingLabel: string;
    emptyLabel: string;
    label: string;
    /** Legend entries for the heatmap. */
    legend: Array<{ state: ServiceState; label: string; color: string }>;
  };
  slo: SloRow[];
  incidents: {
    rows: IncidentRow[];
    openCount: number;
    resolvedCount: number;
    openLabel: string;
    resolvedLabel: string;
    emptyLabel: string;
  };
  detail: TimelineDetail;
  hidden: ReadonlySet<string>;
}

export interface UptimeViewModelInput {
  store: UptimeStore;
  theme: ThemeTokens;
  t: Translator;
  filters: UptimeFilter;
  selectionId: string | null;
  selectedIncidentId: string | null;
  scrollTop: number;
  /** First rendered row (from `computeTimelineWindow`). */
  first: number;
  /** Number of rows to materialise. */
  count: number;
  /** Day-cell width (kept for hosts that reason about the heatmap density). */
  cellWidth: number;
  /** Row height, deciding the compact label mode. */
  rowHeight?: number;
  connectionState?: string;
  hiddenSections?: Partial<Record<string, boolean>>;
  now?: number;
}

const STATE_LABELS: Record<ServiceState, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  maintenance: 'Maintenance',
  unknown: 'Unknown',
};

const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
  maintenance: 'Maintenance',
};

/** Builds the full presentation model for one frame. */
export function buildUptimeViewModel(input: UptimeViewModelInput): UptimeViewModel {
  const { store, theme, t, filters } = input;
  const hidden = hiddenSections(input.hiddenSections);
  const stats = store.stats();
  const filtered = store.filtered(filters);
  const first = Math.max(0, Math.min(input.first, Math.max(0, filtered.length - 1)));
  const window = filtered.slice(first, first + Math.max(0, input.count));
  const now = input.now ?? Date.now();
  const compact = (input.rowHeight ?? 30) < 26;

  const rows = window.map((service, index) =>
    toTimelineRow(service, theme, t, first + index, input.selectionId, compact, now),
  );
  const days = filtered.reduce((max, service) => Math.max(max, service.days.length), 0);
  const selectedService = input.selectionId ? store.get(input.selectionId) ?? null : null;
  const selectedIncident = input.selectedIncidentId ? store.getIncident(input.selectedIncidentId) ?? null : null;

  return {
    toolbar: {
      title: t('uptime.title'),
      subtitle: t('uptime.subtitle'),
      connection: connectionModel(t, input.connectionState ?? 'idle'),
      counters: counters(t, stats),
      actions: actions(t, filters),
      summary: summary(t, stats),
    },
    filters: {
      states: stateChips(t, theme, filters, stats),
      groups: groupChips(theme, filters, stats),
      query: filters.query,
      activeCount:
        (filters.states.length > 0 ? 1 : 0) + (filters.groups.length > 0 ? 1 : 0) + (filters.query ? 1 : 0) + (filters.attentionOnly ? 1 : 0),
      attentionOnly: filters.attentionOnly ?? false,
    },
    timeline: {
      rows,
      total: rows.length,
      windowSize: rows.length,
      filteredTotal: filtered.length,
      scrollTop: input.scrollTop,
      days,
      monthLabels: monthLabels(eachDayStart(filtered), now),
      pending: stats.total === 0,
      pendingLabel: t('status.connecting'),
      emptyLabel: t('uptime.empty'),
      label: `${filtered.length} / ${stats.total} ${t('uptime.services')}`,
      legend: legend(theme),
    },
    slo: sloRows(filtered.length > 0 ? filtered : store.all(), theme, 8),
    incidents: incidentBlock(t, theme, store, input.selectedIncidentId, now),
    detail: detailBlock(t, theme, selectedService, selectedIncident, store, now),
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

/** Oldest day across the visible services (anchor for the month axis). */
function eachDayStart(services: readonly UptimeService[]): number[] {
  const days = new Set<number>();
  for (const service of services) {
    for (const day of service.days) days.add(day.day);
  }
  return [...days].sort((a, b) => a - b);
}

function toTimelineRow(
  service: UptimeService,
  theme: ThemeTokens,
  t: Translator,
  index: number,
  selectionId: string | null,
  compact: boolean,
  now: number,
): TimelineRow {
  const cells: TimelineCell[] = service.days.map((day) => ({
    day: day.day,
    state: day.state,
    color: stateColor(day.state, theme),
    uptime: day.uptime,
    incidents: day.incidents,
  }));
  const breached = service.uptime < service.sloTarget;

  return {
    id: service.id,
    index,
    name: service.name,
    group: service.group ?? 'ungrouped',
    state: service.state,
    statusColor: stateColor(service.state, theme),
    uptimeLabel: formatPercent(service.uptime, service.uptime > 99 ? 2 : 1),
    sloLabel: `${t('uptime.slo.target')} ${formatPercent(service.sloTarget, service.sloTarget % 1 === 0 ? 0 : 2)}`,
    breached,
    errorBudgetUsed: service.errorBudgetUsed,
    budgetLabel: `${formatPercent(Math.min(100, service.errorBudgetUsed), 0)} ${t('uptime.slo.budget')}`,
    cells,
    spark: service.days.map((day) => day.uptime),
    ...(service.activeIncidentId ? { activeIncidentId: service.activeIncidentId } : {}),
    selected: service.id === selectionId,
    compact,
    ...(now ? {} : {}),
  };
}

/** Server-state colour, shared by the cells, rails and chips. */
export function stateColor(state: ServiceState, theme: ThemeTokens): string {
  switch (state) {
    case 'operational':
      return theme.status.ok;
    case 'degraded':
      return theme.status.warning;
    case 'partial_outage':
      return theme.accents[4] ?? theme.status.warning;
    case 'major_outage':
      return theme.status.critical;
    case 'maintenance':
      return theme.accents[3] ?? theme.textMuted;
    default:
      return theme.status.unknown;
  }
}

function legend(theme: ThemeTokens): Array<{ state: ServiceState; label: string; color: string }> {
  return (['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] as ServiceState[]).map(
    (state) => ({ state, label: STATE_LABELS[state], color: stateColor(state, theme) }),
  );
}

/** Month markers for the heatmap axis (`Jan`, `Feb`, …). */
export function monthLabels(days: readonly number[], now: number): Array<{ index: number; label: string }> {
  const labels: Array<{ index: number; label: string }> = [];
  let lastMonth = -1;
  days.forEach((day, index) => {
    const date = new Date(day);
    const month = date.getMonth();
    if (month !== lastMonth) {
      labels.push({ index, label: date.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) });
      lastMonth = month;
    }
  });
  void now;
  return labels;
}


function counters(t: Translator, stats: UptimeStats): TimelineCounter[] {
  return [
    { id: 'services', label: t('uptime.services'), value: String(stats.total), tone: 'neutral' },
    {
      id: 'overall',
      label: 'availability',
      value: formatPercent(stats.overallUptime, 2),
      tone: stats.overallUptime >= 99.9 ? 'ok' : stats.overallUptime >= 99 ? 'warning' : 'critical',
    },
    {
      id: 'belowSlo',
      label: t('uptime.belowSlo'),
      value: String(stats.belowSlo),
      tone: stats.belowSlo > 0 ? 'warning' : 'ok',
    },
    {
      id: 'incidents',
      label: t('uptime.openIncidents'),
      value: String(stats.openIncidents),
      tone: stats.openIncidents > 0 ? 'critical' : 'ok',
    },
  ];
}

function summary(t: Translator, stats: UptimeStats): Array<{ label: string; value: string }> {
  return [
    { label: t('uptime.mttr'), value: stats.mttr > 0 ? formatUptime(stats.mttr / 1000) : '—' },
    { label: t('uptime.mtbf'), value: stats.mtbf > 0 ? formatUptime(stats.mtbf / 1000) : '—' },
    { label: t('uptime.window'), value: `${stats.windowDays}d` },
  ];
}

function actions(t: Translator, filters: UptimeFilter): TimelineAction[] {
  return [
    { id: 'attention', label: t('uptime.attention'), active: filters.attentionOnly ?? false, disabled: false },
    { id: 'refresh', label: t('uptime.refresh'), active: false, disabled: false },
    {
      id: 'copy',
      label: t('grid.copy'),
      active: false,
      disabled: filters.states.length === 0 && filters.groups.length === 0 && !filters.query,
    },
  ];
}

function stateChips(t: Translator, theme: ThemeTokens, filters: UptimeFilter, stats: UptimeStats): StateChip[] {
  const chips: StateChip[] = [
    { state: 'all', label: t('log.all'), count: stats.total, active: filters.states.length === 0, color: theme.textMuted },
  ];
  for (const state of ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] as ServiceState[]) {
    const count = stats.byState[state];
    if (count === 0 && state !== 'operational' && state !== 'degraded') continue;
    chips.push({
      state,
      label: STATE_LABELS[state],
      count,
      active: filters.states.includes(state),
      color: stateColor(state, theme),
    });
  }
  return chips;
}

function groupChips(theme: ThemeTokens, filters: UptimeFilter, stats: UptimeStats): GroupChip[] {
  return stats.byGroup.slice(0, 5).map((entry, index) => ({
    group: entry.group,
    count: entry.count,
    impacted: entry.impacted,
    active: filters.groups.includes(entry.group),
    color: theme.accents[index % theme.accents.length]!,
  }));
}

/** Worst services first: below SLO, then lowest availability. */
function sloRows(services: readonly UptimeService[], theme: ThemeTokens, limit: number): SloRow[] {
  return [...services]
    .sort((a, b) => a.uptime - b.uptime || b.errorBudgetUsed - a.errorBudgetUsed)
    .slice(0, limit)
    .map((service) => {
      const tone = service.uptime < service.sloTarget ? 'critical' : service.errorBudgetUsed >= 75 ? 'warning' : 'ok';
      return {
        id: service.id,
        name: service.name,
        uptimeLabel: formatPercent(service.uptime, 2),
        targetLabel: `${formatPercent(service.sloTarget, service.sloTarget % 1 === 0 ? 0 : 2)}`,
        uptimePercent: Math.max(0, Math.min(100, ((service.uptime - 90) / 10) * 100)),
        targetPercent: Math.max(0, Math.min(100, ((service.sloTarget - 90) / 10) * 100)),
        budgetUsed: Math.min(100, service.errorBudgetUsed),
        budgetLabel: formatPercent(Math.min(100, service.errorBudgetUsed), 0),
        tone,
        color: tone === 'critical' ? theme.status.critical : tone === 'warning' ? theme.status.warning : theme.status.ok,
      };
    });
}



function incidentBlock(
  t: Translator,
  theme: ThemeTokens,
  store: UptimeStore,
  selectedIncidentId: string | null,
  now: number,
): UptimeViewModel['incidents'] {
  const incidents = store.allIncidents();
  const rows: IncidentRow[] = incidents.map((incident) => {
    const open = incident.state !== 'resolved';
    const end = incident.resolvedAt ?? now;
    const color =
      incident.severity === 'critical'
        ? theme.status.critical
        : incident.severity === 'major'
          ? theme.accents[4] ?? theme.status.warning
          : incident.severity === 'maintenance'
            ? theme.accents[3] ?? theme.textMuted
            : theme.status.warning;
    return {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      severityLabel: SEVERITY_LABELS[incident.severity],
      color,
      state: incident.state,
      stateLabel: stateLabel(t, incident.state),
      open,
      durationLabel: formatUptime(Math.max(0, (end - incident.startedAt) / 1000)),
      ageLabel: formatUptime(Math.max(0, (now - incident.startedAt) / 1000)),
      servicesLabel:
        store
          .servicesForIncident(incident)
          .map((service) => service.name)
          .slice(0, 2)
          .join(', ') || `${incident.services.length} services`,
      selected: incident.id === selectedIncidentId,
    };
  });

  rows.sort((a, b) => Number(b.open) - Number(a.open) || Number(b.selected) - Number(a.selected));

  return {
    rows,
    openCount: rows.filter((row) => row.open).length,
    resolvedCount: rows.filter((row) => !row.open).length,
    openLabel: t('uptime.incidents.open'),
    resolvedLabel: t('uptime.incidents.resolved'),
    emptyLabel: t('uptime.incidents.empty'),
  };
}

function stateLabel(t: Translator, state: UptimeIncident['state']): string {
  switch (state) {
    case 'investigating':
      return t('status.connecting');
    case 'identified':
      return 'Identified';
    case 'monitoring':
      return 'Monitoring';
    default:
      return t('uptime.incidents.resolved');
  }
}

function detailBlock(
  t: Translator,
  theme: ThemeTokens,
  service: UptimeService | null,
  incident: UptimeIncident | null,
  store: UptimeStore,
  now: number,
): TimelineDetail {
  if (!service && !incident) {
    return {
      kind: 'none',
      title: t('uptime.detail'),
      subtitle: t('uptime.detail.empty'),
      statusLabel: '—',
      statusColor: theme.textFaint,
      rows: [],
      updates: [],
      cells: [],
    };
  }

  if (incident) {
    const end = incident.resolvedAt ?? now;
    return {
      kind: 'incident',
      title: incident.title,
      subtitle: `${SEVERITY_LABELS[incident.severity]} · ${formatUptime(Math.max(0, (end - incident.startedAt) / 1000))}`,
      statusLabel: stateLabel(t, incident.state),
      statusColor: incident.severity === 'critical' ? theme.status.critical : theme.status.warning,
      rows: [
        { label: 'severity', value: SEVERITY_LABELS[incident.severity] },
        { label: 'state', value: stateLabel(t, incident.state) },
        { label: 'started', value: new Date(incident.startedAt).toLocaleString() },
        { label: 'resolved', value: incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString() : '—' },
        { label: 'duration', value: formatUptime(Math.max(0, (end - incident.startedAt) / 1000)) },
        {
          label: 'services',
          value: store.servicesForIncident(incident).map((entry) => entry.name).join(', ') || '—',
        },
        ...(incident.impact != null ? [{ label: 'impact', value: `${incident.impact}% of requests` }] : []),
      ],
      updates: incident.updates.map((update) => ({
        at: new Date(update.at).toLocaleTimeString(),
        state: stateLabel(t, update.state),
        message: update.message,
      })),
      cells: [],
    };
  }

  const selected = service!;
  return {
    kind: 'service',
    title: selected.name,
    subtitle: `${selected.group ?? 'ungrouped'} · ${formatPercent(selected.uptime, 2)} ${t('uptime.window')}`,
    statusLabel: STATE_LABELS[selected.state],
    statusColor: stateColor(selected.state, theme),
    rows: [
      { label: 'state', value: STATE_LABELS[selected.state] },
      { label: 'uptime', value: formatPercent(selected.uptime, 3) },
      { label: 'slo', value: formatPercent(selected.sloTarget, 2) },
      {
        label: 'budget',
        value: `${formatPercent(Math.min(100, selected.errorBudgetUsed), 0)} ${t('uptime.slo.budget')}`,
      },
      { label: 'days', value: `${selected.days.length} ${t('uptime.checkpoints')}` },
      ...(selected.latency?.p95 != null ? [{ label: 'p95', value: `${Math.round(selected.latency.p95)} ms` }] : []),
      ...(selected.activeIncidentId ? [{ label: 'incident', value: selected.activeIncidentId }] : []),
    ],
    updates: [],
    cells: selected.days.map((day) => ({
      day: day.day,
      state: day.state,
      color: stateColor(day.state, theme),
      uptime: day.uptime,
      incidents: day.incidents,
    })),
  };
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
  return { state, label, description: t('uptime.subtitle') };
}

