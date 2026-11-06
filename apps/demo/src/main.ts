import {
  ALL_SECTIONS,
  ServerMonitorElement,
  defineServerMonitor,
  type SectionId,
} from '@widgets/server-monitor';
import type { ServerMonitorConfig } from '@widgets/server-monitor';

defineServerMonitor();

const MONITOR_HOST = 'ws://localhost:4310/stream';
const METRICS_URL = 'http://localhost:4310/api/v1/server/metrics';

const widget = document.getElementById('monitor') as ServerMonitorElement;
const sourceSelect = document.getElementById('source') as HTMLSelectElement;
const themeSelect = document.getElementById('theme') as HTMLSelectElement;
const columnsSelect = document.getElementById('columns') as HTMLSelectElement;
const localeSelect = document.getElementById('locale') as HTMLSelectElement;
const stressInput = document.getElementById('stress') as HTMLInputElement;
const eventsList = document.getElementById('events') as HTMLUListElement;
const toggles = document.getElementById('toggles') as HTMLDivElement;

const sections: Partial<Record<SectionId, boolean>> = {};

/** Resolves the selected demo source into a widget configuration. */
function sourceConfig(): Pick<ServerMonitorConfig, 'source'> {
  const baseline = Number(stressInput.value);
  switch (sourceSelect.value) {
    case 'ws':
      return { source: { transport: 'websocket', url: MONITOR_HOST } };
    case 'sse':
      return { source: { transport: 'sse', url: 'http://localhost:4310/api/v1/server/events' } };
    case 'http':
      return { source: { transport: 'http', url: METRICS_URL, intervalMs: 1500 } };
    case 'flat':
      return { source: { transport: 'http', url: `${METRICS_URL}?shape=flat`, intervalMs: 1500 } };
    default:
      return {
        source: {
          transport: 'mock',
          intervalMs: 1200,
          cpuBaseline: baseline,
          cores: 16,
          hostname: 'prod-edge-01',
        },
      };
  }
}

function applyConfig(): void {
  widget.setConfig({
    ...sourceConfig(),
    theme: themeSelect.value === 'light' ? 'light' : 'dark',
    locale: localeSelect.value,
    ...(columnsSelect.value === 'auto' ? {} : { columns: Number(columnsSelect.value) as 1 | 2 }),
    sections,
    tooltips: true,
    onAction: (action, payload) => {
      pushEvent(`action · ${action}${payload ? ` · ${JSON.stringify(payload)}` : ''}`);
    },
    onError: (error) => pushEvent(`error · ${error.message}`),
  });
}

function pushEvent(message: string): void {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  eventsList.prepend(item);
  while (eventsList.children.length > 24) eventsList.lastElementChild?.remove();
}

// Section visibility toggles.
for (const id of ALL_SECTIONS) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = true;
  input.dataset.section = id;
  label.append(input, document.createTextNode(id));
  toggles.append(label);
  input.addEventListener('change', () => {
    sections[id] = input.checked;
    applyConfig();
  });
}

// Widget events feed the side panel.
widget.addEventListener('widget-snapshot', (event) => {
  const snapshot = (event as CustomEvent).detail as { cpu: { usage: number }; host: { name: string } };
  pushEvent(`snapshot · ${snapshot.host.name} · cpu ${snapshot.cpu.usage.toFixed(1)}%`);
});
widget.addEventListener('widget-alert', (event) => {
  const alert = (event as CustomEvent).detail as { metric: string; to: string; value: number };
  pushEvent(`alert · ${alert.metric} → ${alert.to} (${alert.value.toFixed(1)})`);
});

sourceSelect.addEventListener('change', applyConfig);
themeSelect.addEventListener('change', applyConfig);
columnsSelect.addEventListener('change', applyConfig);
localeSelect.addEventListener('change', applyConfig);

// The stress slider re-seeds the in-process mock generator so charts react live.
stressInput.addEventListener('input', () => {
  if (sourceSelect.value === 'mock') applyConfig();
});
stressInput.addEventListener('change', () => pushEvent(`mock cpu baseline = ${stressInput.value}%`));

// Deep-link the demo state (handy for screenshots, docs and visual tests):
//   /?theme=light&columns=1&source=ws&locale=fa&stress=85
const params = new URLSearchParams(location.search);
const setSelect = (element: HTMLSelectElement, value: string | null) => {
  if (value && [...element.options].some((option) => option.value === value)) element.value = value;
};

setSelect(sourceSelect, params.get('source'));
setSelect(themeSelect, params.get('theme'));
setSelect(columnsSelect, params.get('columns'));
setSelect(localeSelect, params.get('locale'));
if (params.get('stress')) stressInput.value = params.get('stress') as string;

applyConfig();
pushEvent('demo ready · pick a data source to stream live metrics');
