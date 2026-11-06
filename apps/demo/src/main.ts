import {
  ALL_SECTIONS,
  ServerMonitorElement,
  defineServerMonitor,
  type SectionId,
} from '@widgets/server-monitor';
import {
  LOG_SECTIONS,
  LogStreamElement,
  defineLogStream,
  type LogSectionId,
} from '@widgets/log-stream';
import {
  ContainerGridElement,
  GRID_SECTIONS,
  defineContainerGrid,
  type GridSectionId,
} from '@widgets/container-grid';

defineServerMonitor();
defineLogStream();
defineContainerGrid();

const METRICS_WS = 'ws://localhost:4310/stream';
const METRICS_HTTP = 'http://localhost:4310/api/v1/server/metrics';
const LOGS_WS = 'ws://localhost:4310/logs/stream';
const LOGS_HTTP = 'http://localhost:4310/api/v1/logs';
const LOGS_SSE = 'http://localhost:4310/api/v1/logs/events';
const CONTAINERS_WS = 'ws://localhost:4310/containers/stream';
const CONTAINERS_HTTP = 'http://localhost:4310/api/v1/containers';
const CONTAINERS_SSE = 'http://localhost:4310/api/v1/containers/events';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const monitor = $<ServerMonitorElement>('monitor');
const logs = $<LogStreamElement>('logs');
const fleet = $<ContainerGridElement>('fleet');
const eventsList = $<HTMLUListElement>('events');
const toggles = $<HTMLDivElement>('toggles');
const snippet = $<HTMLElement>('snippet');
const controlsMetrics = $('controls-metrics');
const controlsLogs = $('controls-logs');
const controlsContainers = $('controls-containers');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];

type WidgetKind = 'metrics' | 'logs' | 'containers';
let active: WidgetKind = 'metrics';

const metricSections: Partial<Record<SectionId, boolean>> = {};
const logSections: Partial<Record<LogSectionId, boolean>> = {};
const containerSections: Partial<Record<GridSectionId, boolean>> = {};

const metricControls = {
  source: $<HTMLSelectElement>('m-source'),
  theme: $<HTMLSelectElement>('m-theme'),
  columns: $<HTMLSelectElement>('m-columns'),
  locale: $<HTMLSelectElement>('m-locale'),
  stress: $<HTMLInputElement>('m-stress'),
};

const containerControls = {
  source: $<HTMLSelectElement>('c-source'),
  theme: $<HTMLSelectElement>('c-theme'),
  columns: $<HTMLSelectElement>('c-columns'),
  locale: $<HTMLSelectElement>('c-locale'),
  sort: $<HTMLSelectElement>('c-sort'),
  attention: $<HTMLSelectElement>('c-attention'),
};

const logControls = {
  source: $<HTMLSelectElement>('l-source'),
  theme: $<HTMLSelectElement>('l-theme'),
  columns: $<HTMLSelectElement>('l-columns'),
  locale: $<HTMLSelectElement>('l-locale'),
  level: $<HTMLSelectElement>('l-level'),
  follow: $<HTMLSelectElement>('l-follow'),
};

function pushEvent(message: string): void {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  eventsList.prepend(item);
  while (eventsList.children.length > 26) eventsList.lastElementChild?.remove();
}

// ── Server monitor ────────────────────────────────────────────────────────

function metricSource(): Record<string, unknown> {
  switch (metricControls.source.value) {
    case 'ws':
      return { transport: 'websocket', url: METRICS_WS };
    case 'sse':
      return { transport: 'sse', url: 'http://localhost:4310/api/v1/server/events' };
    case 'http':
      return { transport: 'http', url: METRICS_HTTP, intervalMs: 1500 };
    case 'flat':
      return { transport: 'http', url: `${METRICS_HTTP}?shape=flat`, intervalMs: 1500 };
    default:
      return {
        transport: 'mock',
        intervalMs: 1200,
        cpuBaseline: Number(metricControls.stress.value),
      };
  }
}

function applyMetrics(): void {
  monitor.setConfig({
    source: metricSource() as never,
    theme: metricControls.theme.value === 'light' ? 'light' : 'dark',
    locale: metricControls.locale.value,
    ...(metricControls.columns.value === 'auto'
      ? {}
      : { columns: Number(metricControls.columns.value) as 1 | 2 }),
    sections: metricSections,
    tooltips: true,
    onAction: (action, payload) =>
      pushEvent(`metrics action · ${action}${payload ? ` · ${JSON.stringify(payload)}` : ''}`),
    onError: (error) => pushEvent(`metrics error · ${error.message}`),
  });
}

// ── Log stream ────────────────────────────────────────────────────────────

function logSource(): Record<string, unknown> {
  switch (logControls.source.value) {
    case 'ws':
      return { transport: 'websocket', url: LOGS_WS };
    case 'sse':
      return { transport: 'sse', url: LOGS_SSE };
    case 'http':
      return { transport: 'http', url: LOGS_HTTP, intervalMs: 1500 };
    case 'raw':
      return { transport: 'http', url: `${LOGS_HTTP}?shape=raw`, intervalMs: 1500 };
    case 'mockBurst':
      return { transport: 'mock', intervalMs: 900, burst: true, count: 6 };
    default:
      return { transport: 'mock', intervalMs: 900, count: 5 };
  }
}

function applyLogs(): void {
  const level = logControls.level.value;
  logs.setConfig({
    source: logSource() as never,
    theme: logControls.theme.value === 'light' ? 'light' : 'dark',
    locale: logControls.locale.value,
    ...(logControls.columns.value === 'auto'
      ? {}
      : { columns: Number(logControls.columns.value) as 1 | 2 }),
    filters: {
      levels: [],
      services: [],
      query: '',
      minLevel: level === '' ? 'all' : (level as 'info' | 'warn' | 'error'),
    },
    follow: logControls.follow.value === 'true',
    sections: logSections,
    tooltips: true,
    onAction: (action, payload) =>
      pushEvent(`logs action · ${action}${payload ? ` · ${JSON.stringify(payload)}` : ''}`),
    onError: (error) => pushEvent(`logs error · ${error.message}`),
  });
}


// ── Container grid ────────────────────────────────────────────────────────

function containerSource(): Record<string, unknown> {
  switch (containerControls.source.value) {
    case 'ws':
      return { transport: 'websocket', url: CONTAINERS_WS };
    case 'sse':
      return { transport: 'sse', url: CONTAINERS_SSE };
    case 'http':
      return { transport: 'http', url: CONTAINERS_HTTP, intervalMs: 3000 };
    case 'k8s':
      return { transport: 'http', url: `${CONTAINERS_HTTP}?shape=k8s`, intervalMs: 3000 };
    case 'mockIncident':
      return { transport: 'mock', intervalMs: 2000, size: 24, incident: true };
    default:
      return { transport: 'mock', intervalMs: 2500, size: 24 };
  }
}

function applyContainers(): void {
  fleet.setConfig({
    source: containerSource() as never,
    theme: containerControls.theme.value === 'light' ? 'light' : 'dark',
    locale: containerControls.locale.value,
    sort: containerControls.sort.value as never,
    ...(containerControls.columns.value === 'auto'
      ? {}
      : { columns: Number(containerControls.columns.value) as 1 | 2 }),
    filters: { ...fleet.filter, attentionOnly: containerControls.attention.value === 'true' },
    sections: containerSections,
    tooltips: true,
    onAction: (action, payload) =>
      pushEvent(`grid action · ${action}${payload ? ` · ${JSON.stringify(payload)}` : ''}`),
    onError: (error) => pushEvent(`grid error · ${error.message}`),
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────

const SNIPPETS: Record<WidgetKind, string> = {
  metrics: `<server-monitor
  src="ws://localhost:4310/stream"
  transport="websocket"
  theme="dark"
></server-monitor>

<script type="module"
  src="./server-monitor.global.js"></script>`,
  containers: `<container-grid
  src="ws://localhost:4310/containers/stream"
  transport="websocket"
  sort="severity"
  attention="false"
></container-grid>

<script type="module"
  src="./container-grid.global.js"></script>`,
  logs: `<log-stream
  src="ws://localhost:4310/logs/stream"
  transport="websocket"
  level="warn"
  follow="true"
></log-stream>

<script type="module"
  src="./log-stream.global.js"></script>`,
};

function renderSectionToggles(): void {
  toggles.innerHTML = '';
  const ids: readonly string[] =
    active === 'metrics' ? ALL_SECTIONS : active === 'logs' ? LOG_SECTIONS : GRID_SECTIONS;
  const state = active === 'metrics' ? metricSections : active === 'logs' ? logSections : containerSections;
  for (const id of ids) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = (state as Record<string, boolean | undefined>)[id] !== false;
    label.append(input, document.createTextNode(id));
    toggles.append(label);
    input.addEventListener('change', () => {
      (state as Record<string, boolean>)[id] = input.checked;
      if (active === 'metrics') applyMetrics();
      else if (active === 'logs') applyLogs();
      else applyContainers();
    });
  }
}

function setActive(next: WidgetKind): void {
  active = next;
  for (const tab of tabs) {
    const isActive = tab.dataset.widget === next;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  }
  controlsMetrics.hidden = next !== 'metrics';
  controlsLogs.hidden = next !== 'logs';
  controlsContainers.hidden = next !== 'containers';
  monitor.hidden = next !== 'metrics';
  logs.hidden = next !== 'logs';
  fleet.hidden = next !== 'containers';
  snippet.querySelector('code')!.textContent = SNIPPETS[next];
  renderSectionToggles();

  if (next === 'metrics') {
    applyMetrics();
    pushEvent('switched to server-monitor');
  } else if (next === 'logs') {
    applyLogs();
    pushEvent('switched to log-stream');
  } else {
    applyContainers();
    pushEvent('switched to container-grid');
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => setActive((tab.dataset.widget as WidgetKind) ?? 'metrics'));
}

// ── Widget events ─────────────────────────────────────────────────────────

monitor.addEventListener('widget-snapshot', (event) => {
  const snapshot = (event as CustomEvent).detail as { host: { name: string }; cpu: { usage: number } };
  pushEvent(`metrics · ${snapshot.host.name} · cpu ${snapshot.cpu.usage.toFixed(1)}%`);
});
monitor.addEventListener('widget-alert', (event) => {
  const alert = (event as CustomEvent).detail as { metric: string; to: string; value: number };
  pushEvent(`metrics alert · ${alert.metric} → ${alert.to} (${alert.value.toFixed(1)})`);
});

logs.addEventListener('widget-snapshot', (event) => {
  const snapshot = (event as CustomEvent).detail as { entries: unknown[] };
  pushEvent(`logs · batch of ${snapshot.entries.length}`);
});
logs.addEventListener('widget-critical', (event) => {
  const entry = (event as CustomEvent).detail as { service: string; message: string };
  pushEvent(`logs critical · ${entry.service}: ${entry.message}`);
});
logs.addEventListener('widget-select', (event) => {
  const entry = (event as CustomEvent).detail as { service: string };
  pushEvent(`logs select · ${entry.service}`);
});

fleet.addEventListener('widget-snapshot', (event) => {
  const snapshot = (event as CustomEvent).detail as { containers: unknown[] };
  pushEvent(`grid · fleet snapshot (${snapshot.containers.length} workloads)`);
});
fleet.addEventListener('widget-transition', (event) => {
  const payload = (event as CustomEvent).detail as { container: { name: string }; from: string; to: string };
  pushEvent(`grid transition · ${payload.container.name} ${payload.from} → ${payload.to}`);
});

// ── Control wiring ────────────────────────────────────────────────────────

for (const control of Object.values(metricControls)) {
  control.addEventListener('change', () => {
    if (active === 'metrics') applyMetrics();
  });
}
metricControls.stress.addEventListener('input', () => {
  if (active === 'metrics' && metricControls.source.value === 'mock') applyMetrics();
});
for (const control of Object.values(logControls)) {
  control.addEventListener('change', () => {
    if (active === 'logs') applyLogs();
  });
}
for (const control of Object.values(containerControls)) {
  control.addEventListener('change', () => {
    if (active === 'containers') applyContainers();
  });
}

// ── Deep links ────────────────────────────────────────────────────────────
//   /?widget=logs&l-source=ws&l-level=warn&l-theme=light&l-columns=1&l-locale=fa
//   /?widget=metrics&m-source=flat&m-theme=light&m-columns=1
const params = new URLSearchParams(location.search);
const setSelect = (element: HTMLSelectElement, value: string | null) => {
  if (value && [...element.options].some((option) => option.value === value)) element.value = value;
};

setSelect(metricControls.source, params.get('m-source'));
setSelect(metricControls.theme, params.get('m-theme'));
setSelect(metricControls.columns, params.get('m-columns'));
setSelect(metricControls.locale, params.get('m-locale'));
if (params.get('m-stress')) metricControls.stress.value = params.get('m-stress') as string;

setSelect(logControls.source, params.get('l-source'));
setSelect(logControls.theme, params.get('l-theme'));
setSelect(logControls.columns, params.get('l-columns'));
setSelect(logControls.locale, params.get('l-locale'));
setSelect(logControls.level, params.get('l-level'));
setSelect(logControls.follow, params.get('l-follow'));

setSelect(containerControls.source, params.get('c-source'));
setSelect(containerControls.theme, params.get('c-theme'));
setSelect(containerControls.columns, params.get('c-columns'));
setSelect(containerControls.locale, params.get('c-locale'));
setSelect(containerControls.sort, params.get('c-sort'));
setSelect(containerControls.attention, params.get('c-attention'));

const requested = params.get('widget');
setActive(requested === 'logs' ? 'logs' : requested === 'containers' ? 'containers' : 'metrics');
pushEvent('playground ready · pick a data source to stream live data');


