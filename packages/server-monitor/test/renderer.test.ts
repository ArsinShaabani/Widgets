import { describe, expect, it } from 'vitest';
import {
  createMockSnapshot,
  createTranslator,
  mergeThresholds,
  resolveTheme,
  WidgetStore,
  type MetricHistory,
} from '@widgets/core';
import { buildViewModel, computeLayout, renderDashboard } from '../src/index';
import { createFakeContext } from '@widgets/render/testing';

const theme = resolveTheme('dark');
const t = createTranslator('en');
const thresholds = mergeThresholds();

function emptyHistory(): MetricHistory {
  return { cpu: [], memory: [], disk: [], networkRx: [], networkTx: [], load: [] };
}

function renderAt(width: number, height: number, hidden?: Record<string, boolean>, pending = false) {
  const snapshot = pending ? null : createMockSnapshot({ elapsedSeconds: 90 });
  const store = new WidgetStore();
  if (snapshot) store.update(snapshot);
  const layout = computeLayout({ width, height, padding: 20, gap: 16 });
  const vm = buildViewModel({
    snapshot,
    history: store.historySnapshot(),
    theme,
    thresholds,
    t,
    ...(hidden ? { hiddenSections: hidden as never } : {}),
  });
  const ctx = createFakeContext();
  const result = renderDashboard(ctx, { theme, layout, vm });
  return { ctx, layout, vm, result };
}

describe('renderDashboard', () => {
  it('paints a full dashboard and reports interactive regions', () => {
    const { ctx, result } = renderAt(1280, 880);

    expect(ctx.calls.fillRect).toBeGreaterThan(0);
    expect(ctx.calls.fill).toBeGreaterThan(10);
    expect(ctx.calls.fillText).toBeGreaterThan(10);
    expect(result.regions.length).toBeGreaterThan(15);

    const ids = result.regions.map((region) => region.id);
    expect(ids).toContain('cpu-core-0');
    expect(ids).toContain('gauge-cpu');
    expect(ids).toContain('donut-memory');
    expect(ids).toContain('badge-cpu');
    expect(ids).toContain('action-settings');
    expect(ids).toContain('host-card');
  });

  it('uses the gradient tokens for the per-core bars', () => {
    const { ctx } = renderAt(1280, 880);
    expect(ctx.gradients.length).toBeGreaterThan(0);
    const barStops = ctx.gradients.map((gradient) => gradient.map(([, color]) => color));
    expect(barStops).toContainEqual([theme.gradient[0], theme.gradient[1], theme.gradient[2]]);
  });

  it('writes the host identity and metric copy into the canvas', () => {
    const { ctx } = renderAt(1280, 880);
    const text = ctx.texts.join(' | ');
    expect(text).toContain('prod-edge-01');
    expect(text).toContain('01');
    expect(text).toMatch(/%/);
  });

  it('skips hidden sections', () => {
    const { result } = renderAt(1280, 880, { donuts: false, actions: false });
    const ids = result.regions.map((region) => region.id);
    expect(ids).not.toContain('donut-memory');
    expect(ids.some((id) => id.startsWith('action-'))).toBe(false);
  });

  it('renders a pending state without any data', () => {
    const { ctx, result, vm } = renderAt(900, 620, undefined, true);
    expect(vm.pending).toBe(true);
    expect(ctx.texts.join(' | ')).toContain('Connecting');
    expect(result.regions.length).toBeGreaterThan(0);
  });

  it('renders the compact single column layout on small viewports', () => {
    const { layout, result } = renderAt(420, 820);
    expect(layout.columns).toBe(1);
    expect(result.regions.map((region) => region.id)).toContain('host-card');
  });

  it('renders hover highlight and tooltip without throwing', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 12 });
    const layout = computeLayout({ width: 1000, height: 760 });
    const vm = buildViewModel({ snapshot, history: emptyHistory(), theme, thresholds, t });
    const ctx = createFakeContext();
    const result = renderDashboard(ctx, {
      theme,
      layout,
      vm,
      hoverId: 'gauge-cpu',
      tooltip: { text: 'CPU · 46.3%', x: 120, y: 200 },
    });
    expect(result.regions.length).toBeGreaterThan(0);
    expect(ctx.texts.join(' | ')).toContain('CPU · 46.3%');
  });
});
