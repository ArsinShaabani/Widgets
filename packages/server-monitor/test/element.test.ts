// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSnapshot } from '@widgets/core';
import { ServerMonitorElement, defineServerMonitor, mockSnapshot } from '../src/index';
import { createFakeContext } from '@widgets/render/testing';

/**
 * Element level tests.
 *
 * jsdom has no 2D canvas, so the fake context is installed on
 * `HTMLCanvasElement.prototype` — which also proves the widget degrades
 * gracefully when `getContext('2d')` is unavailable.
 */

let element: ServerMonitorElement;

beforeEach(() => {
  const fake = createFakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fake as unknown as CanvasRenderingContext2D,
  );
  document.body.innerHTML = '';
  defineServerMonitor('server-monitor');
  element = document.createElement('server-monitor') as ServerMonitorElement;
  element.style.width = '1200px';
  element.style.height = '820px';
  // jsdom reports 0 for layout boxes: give the element a real viewport so the
  // dashboard lays out in two columns exactly like a browser.
  Object.defineProperty(element, 'clientWidth', { value: 1240, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: 880, configurable: true });
  document.body.append(element);
});

afterEach(() => {
  element?.remove();
  vi.restoreAllMocks();
});

describe('ServerMonitorElement', () => {
  it('upgrades, builds a shadow root and paints a frame', async () => {
    expect(element.shadowRoot).not.toBeNull();
    const canvas = element.shadowRoot!.querySelector('canvas');
    expect(canvas).not.toBeNull();

    element.setSnapshot(mockSnapshot());
    element.paint();

    expect(element.viewModel?.pending).toBe(false);
    expect(element.hitRegions.length).toBeGreaterThan(10);
    expect(element.currentLayout?.columns).toBe(2);
  });

  it('renders a headless frame when no 2D context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const headless = document.createElement('server-monitor') as ServerMonitorElement;
    Object.defineProperty(headless, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(headless, 'clientHeight', { value: 700, configurable: true });
    document.body.append(headless);

    headless.setSnapshot(mockSnapshot());
    headless.paint();

    // Layout and view model are still published for native hosts.
    expect(headless.currentLayout).not.toBeNull();
    expect(headless.viewModel).not.toBeNull();
    expect(headless.hitRegions).toHaveLength(0);
    headless.remove();
  });

  it('exposes snapshot / alerts / error events', () => {
    const snapshots: unknown[] = [];
    const alerts: unknown[] = [];
    element.addEventListener('widget-snapshot', (event) => snapshots.push((event as CustomEvent).detail));
    element.addEventListener('widget-alert', (event) => alerts.push((event as CustomEvent).detail));

    element.setSnapshot({ ...createMockSnapshot({ elapsedSeconds: 1 }), cpu: { ...createMockSnapshot({ elapsedSeconds: 1 }).cpu, usage: 5 } });
    element.setSnapshot({ ...createMockSnapshot({ elapsedSeconds: 2 }), cpu: { ...createMockSnapshot({ elapsedSeconds: 2 }).cpu, usage: 98 } });
    element.paint();

    expect(alerts.length).toBeGreaterThan(0);
    expect(snapshots.length).toBe(0); // setSnapshot() is the host path, not the stream path
    expect(element.hostStatus).toBe('critical');
  });

  it('dispatches widget-action when an affordance region is activated', () => {
    element.setSnapshot(mockSnapshot());
    element.paint();

    const actions: Array<{ action: string }> = [];
    element.addEventListener('widget-action', (event) => actions.push((event as CustomEvent).detail));

    const region = element.hitRegions.find((item) => item.action === 'logs');
    expect(region).toBeDefined();

    // Simulate the click path: pointer events are delegated to the canvas.
    const canvas = element.shadowRoot!.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect);
    const centreX = region!.rect.x + region!.rect.width / 2;
    const centreY = region!.rect.y + region!.rect.height / 2;
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: centreX, clientY: centreY }));

    expect(actions).toEqual([{ action: 'logs', payload: undefined }]);
  });

  it('honours config: theme, locale, hidden sections and thresholds', () => {
    element.setConfig({
      theme: 'light',
      locale: 'fa',
      sections: { donuts: false },
      thresholds: { cpu: { warning: 10, critical: 20 } },
    });
    element.setSnapshot({ ...mockSnapshot(), cpu: { ...mockSnapshot().cpu, usage: 55 } });
    element.paint();

    expect(element.viewModel?.gauges[0]?.status).toBe('critical');
    expect(element.viewModel?.gauges[0]?.label).toBe('پردازنده');
    expect(element.hitRegions.some((region) => region.id.startsWith('donut-'))).toBe(false);
  });

  it('reads declarative attributes', () => {
    const tag = document.createElement('server-monitor') as ServerMonitorElement;
    tag.setAttribute('theme', 'light');
    tag.setAttribute('locale', 'fa');
    tag.setAttribute('columns', '1');
    tag.setAttribute('title', 'Fleet');
    document.body.append(tag);
    tag.setSnapshot(mockSnapshot());
    tag.paint();

    expect(tag.currentLayout?.columns).toBe(1);
    expect(tag.viewModel?.gauges[0]?.label).toBe('پردازنده');
    tag.remove();
  });

  it('tears down cleanly when removed from the DOM', () => {
    element.setSnapshot(mockSnapshot());
    element.paint();
    element.remove();
    expect(element.viewModel).toBeNull();
    expect(element.shadowRoot?.children.length ?? 0).toBe(0);
    element = document.createElement('server-monitor') as ServerMonitorElement; // guard for afterEach
  });
});
