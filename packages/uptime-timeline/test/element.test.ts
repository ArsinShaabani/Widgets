// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockUptimeSnapshot, type UptimeSnapshot } from '@widgets/core';
import { createFakeContext } from '@widgets/render/testing';
import { UptimeTimelineElement, defineUptimeTimeline } from '../src/index';

/** Element level tests: upgrade, heatmap virtualisation, selection, filters, teardown. */

let element: UptimeTimelineElement;

const NOW = Date.UTC(2026, 10, 6, 12);
const snapshot = (size = 8, incident = true): UptimeSnapshot =>
  createMockUptimeSnapshot({ size, windowDays: 90, incident, now: NOW });

/** A wide fleet with N services, reused for the virtualisation/scroll tests. */
function wideFleet(count = 120): UptimeSnapshot {
  const base = snapshot(1, false).services[0]!;
  return {
    timestamp: NOW,
    mode: 'replace',
    incidents: [],
    services: Array.from({ length: count }, (_, index) => ({
      ...base,
      id: `group/svc-${index}`,
      name: `svc-${index}`,
      group: `group-${index % 4}`,
    })),
  };
}

beforeEach(() => {
  const fake = createFakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fake as unknown as CanvasRenderingContext2D,
  );
  document.body.innerHTML = '';
  defineUptimeTimeline('uptime-timeline');
  element = document.createElement('uptime-timeline') as UptimeTimelineElement;
  Object.defineProperty(element, 'clientWidth', { value: 1480, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: 900, configurable: true });
  // Quiet source configured before connecting: tests drive the store directly.
  element.setConfig({ source: () => null });
  document.body.append(element);
});

afterEach(() => {
  element?.remove();
  vi.restoreAllMocks();
});

function clickRegion(id: string): void {
  const region = element.hitRegions.find((item) => item.id === id);
  if (!region) throw new Error(`region ${id} not found`);
  const canvas = element.shadowRoot!.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect);
  const x = region.rect.x + 4;
  const y = region.rect.y + Math.min(10, region.rect.height / 2);
  canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }));
  canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y }));
}

describe('UptimeTimelineElement', () => {
  it('upgrades, builds a shadow root with the search field and paints', () => {
    expect(element.shadowRoot).not.toBeNull();
    expect(element.shadowRoot!.querySelector('canvas')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('input.search')).not.toBeNull();

    element.appendBatch(snapshot(6));
    element.paint();

    expect(element.serviceCount).toBe(6);
    expect(element.viewModel!.timeline.rows.length).toBeGreaterThan(0);
    expect(element.currentLayout!.columns).toBe(2);
    expect(element.currentLayout!.geometry.days).toBe(90);
    expect(element.hitRegions.some((region) => region.id.startsWith('row-'))).toBe(true);
  });

  it('virtualises the heatmap for a large fleet', () => {
    element.appendBatch(wideFleet(120));
    element.paint();

    const layout = element.currentLayout!;
    const rows = element.hitRegions.filter((region) => region.id.startsWith('row-'));
    expect(element.serviceCount).toBe(120);
    expect(rows.length).toBeLessThanOrEqual(layout.geometry.visibleRows + 4);
    expect(rows.length).toBeGreaterThan(1);
  });

  it('selects a service row on click and inspects it', () => {
    const data = snapshot(4);
    element.appendBatch(data);
    element.paint();

    const selections: Array<{ id: string }> = [];
    element.addEventListener('widget-select', (event) => selections.push((event as CustomEvent).detail));

    const target = data.services[0]!;
    clickRegion(`row-${target.id}`);
    element.paint();

    expect(element.selectedId).toBe(target.id);
    expect(selections.map((entry) => entry.id)).toContain(target.id);
    expect(element.viewModel!.detail.kind).toBe('service');
    expect(element.viewModel!.detail.title).toBe(target.name);
  });

  it('selects an incident from the log and shows its timeline', () => {
    const data = snapshot(4, true);
    element.appendBatch(data);
    element.paint();

    const incident = data.incidents[0]!;
    clickRegion(`incident-${incident.id}`);
    element.paint();

    expect(element.selectedIncident).toBe(incident.id);
    expect(element.viewModel!.detail.kind).toBe('incident');
    expect(element.viewModel!.detail.updates.length).toBeGreaterThan(0);
  });

  it('applies state and group filters from chips and the property', () => {
    const data = snapshot(6, true);
    element.appendBatch(data);
    element.paint();

    clickRegion('filter-state-major_outage');
    element.paint();
    expect(element.filter.states).toEqual(['major_outage']);
    expect(element.viewModel!.timeline.filteredTotal).toBe(1);

    clickRegion('filter-state-all');
    element.paint();
    expect(element.filter.states).toEqual([]);

    const group = data.services[0]!.group!;
    clickRegion(`filter-group-${group}`);
    element.paint();
    expect(element.filter.groups).toEqual([group]);
    expect(element.viewModel!.timeline.filteredTotal).toBeGreaterThan(0);

    element.filter = { states: [], groups: [], query: 'gateway' };
    element.paint();
    expect(element.viewModel!.timeline.filteredTotal).toBeGreaterThan(0);

    element.filter = { states: [], groups: [], query: '', attentionOnly: true };
    element.paint();
    expect(element.viewModel!.timeline.filteredTotal).toBeGreaterThan(0);
  });

  it('drives the DOM search field', () => {
    element.appendBatch(snapshot(6));
    element.paint();

    const search = element.shadowRoot!.querySelector('input.search') as HTMLInputElement;
    expect(search.style.display).toBe('block');
    search.value = 'postgres';
    search.dispatchEvent(new Event('input'));
    element.paint();

    expect(element.filter.query).toBe('postgres');
    expect(element.viewModel!.timeline.filteredTotal).toBe(1);
  });

  it('navigates rows with the keyboard and scrolls within bounds', () => {
    element.appendBatch(snapshot(8));
    element.paint();
    const canvas = element.shadowRoot!.querySelector('canvas')!;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    element.paint();
    const first = element.selectedId;
    expect(first).not.toBeNull();

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    element.paint();
    expect(element.selectedId).not.toBe(first);

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    element.paint();
    expect(element.viewModel!.timeline.rows[0]!.selected).toBe(true);

    element.appendBatch(wideFleet(120));
    element.paint();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
    element.paint();
    expect(element.viewModel!.timeline.scrollTop).toBeGreaterThan(0);

    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100_000, bubbles: true, cancelable: true }));
    element.paint();
    expect(element.viewModel!.timeline.scrollTop).toBe(0);
  });

  it('emits state transitions to the host and the live region', () => {
    const base = snapshot(1, false);
    element.appendBatch(base);

    const transitions: unknown[] = [];
    element.addEventListener('widget-transition', (event) => transitions.push((event as CustomEvent).detail));
    element.appendBatch({ ...base, services: [{ ...base.services[0]!, state: 'major_outage' }] });

    expect(transitions).toHaveLength(1);
    expect(element.shadowRoot!.querySelector('[aria-live="polite"]')!.textContent).toContain('major_outage');
  });

  it('honours attributes, renders headless and streams from the mock status page', async () => {
    const tag = document.createElement('uptime-timeline') as UptimeTimelineElement;
    Object.defineProperty(tag, 'clientWidth', { value: 1100, configurable: true });
    Object.defineProperty(tag, 'clientHeight', { value: 760, configurable: true });
    tag.setConfig({ source: () => null });
    tag.setAttribute('locale', 'fa');
    tag.setAttribute('columns', '1');
    tag.setAttribute('state', 'major_outage');
    document.body.append(tag);
    tag.appendBatch(snapshot(6, true));
    tag.paint();

    expect(tag.currentLayout!.columns).toBe(1);
    expect(tag.filter.states).toEqual(['major_outage']);
    expect(tag.viewModel!.toolbar.title).toBe('پایداری سرویس');
    expect(tag.viewModel!.timeline.filteredTotal).toBe(1);
    tag.remove();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const headless = document.createElement('uptime-timeline') as UptimeTimelineElement;
    Object.defineProperty(headless, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(headless, 'clientHeight', { value: 700, configurable: true });
    headless.setConfig({ source: () => null });
    document.body.append(headless);
    headless.appendBatch(snapshot(4));
    headless.paint();
    expect(headless.currentLayout).not.toBeNull();
    expect(headless.hitRegions).toHaveLength(0);
    headless.remove();

    const streamed = document.createElement('uptime-timeline') as UptimeTimelineElement;
    Object.defineProperty(streamed, 'clientWidth', { value: 1300, configurable: true });
    Object.defineProperty(streamed, 'clientHeight', { value: 800, configurable: true });
    streamed.setConfig({ source: { transport: 'mock', intervalMs: 0, size: 5, incident: true } });
    document.body.append(streamed);
    await Promise.resolve();

    expect(streamed.serviceCount).toBeGreaterThan(0);
    streamed.paint();
    expect(streamed.viewModel!.timeline.rows.length).toBeGreaterThan(0);
    streamed.remove();
    expect(streamed.viewModel).toBeNull();
    expect(streamed.shadowRoot?.children.length ?? 0).toBe(0);
  });
});

