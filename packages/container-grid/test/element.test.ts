// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContainer, createMockContainerSnapshot } from '@widgets/core';
import { createFakeContext } from '@widgets/render/testing';
import { ContainerGridElement, defineContainerGrid } from '../src/index';

/** Element level tests: upgrade, grid virtualisation, selection, keyboard nav, filters, teardown. */

let element: ContainerGridElement;

beforeEach(() => {
  const fake = createFakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fake as unknown as CanvasRenderingContext2D,
  );
  document.body.innerHTML = '';
  defineContainerGrid('container-grid');
  element = document.createElement('container-grid') as ContainerGridElement;
  Object.defineProperty(element, 'clientWidth', { value: 1400, configurable: true });
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

describe('ContainerGridElement', () => {
  it('upgrades, builds a shadow root with the search field and paints', () => {
    expect(element.shadowRoot).not.toBeNull();
    expect(element.shadowRoot!.querySelector('canvas')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('input.search')).not.toBeNull();

    element.appendBatch(createMockContainerSnapshot({ elapsedSeconds: 42, size: 12 }));
    element.paint();

    expect(element.containerCount).toBe(12);
    expect(element.viewModel!.cards.items.length).toBeGreaterThan(0);
    expect(element.currentLayout!.columns).toBe(2);
    expect(element.currentLayout!.grid.columns).toBeGreaterThan(1);
    expect(element.hitRegions.some((region) => region.id.startsWith('card-'))).toBe(true);
  });

  it('virtualises the grid: a large fleet paints a bounded number of cards', () => {
    element.appendBatch(createMockContainerSnapshot({ elapsedSeconds: 12, size: 400 }));
    element.paint();

    const layout = element.currentLayout!;
    const cards = element.hitRegions.filter((region) => region.id.startsWith('card-'));
    expect(element.containerCount).toBe(400);
    expect(cards.length).toBeLessThanOrEqual((layout.grid.visibleRows + 2) * layout.grid.columns);
    expect(cards.length).toBeGreaterThan(1);
  });

  it('selects a card on click and emits widget-select', () => {
    const target = createMockContainer({ id: 'payments/target-1', name: 'target-1', namespace: 'payments' });
    element.appendBatch({
      timestamp: Date.now(),
      containers: [target, createMockContainer({ id: 'edge/other', name: 'other', namespace: 'edge' })],
      mode: 'replace',
    });
    element.paint();

    const selections: Array<{ id: string }> = [];
    element.addEventListener('widget-select', (event) => selections.push((event as CustomEvent).detail));

    clickRegion(`card-${target.id}`);
    element.paint();

    expect(element.selectedId).toBe(target.id);
    expect(selections.map((entry) => entry.id)).toContain(target.id);
    expect(element.viewModel!.detail.container?.id).toBe(target.id);
  });

  it('navigates with the keyboard in two dimensions', () => {
    element.appendBatch(createMockContainerSnapshot({ elapsedSeconds: 20, size: 24 }));
    element.paint();
    const canvas = element.shadowRoot!.querySelector('canvas')!;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    element.paint();
    const first = element.selectedId;
    expect(first).not.toBeNull();

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    element.paint();
    expect(element.selectedId).not.toBe(first);

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    element.paint();
    expect(element.selectedId).not.toBeNull();

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    element.paint();
    expect(element.viewModel!.cards.items[0]!.selected).toBe(true);
  });

  it('applies phase, namespace and attention filters from chips and the property', () => {
    element.appendBatch({
      timestamp: Date.now(),
      containers: [
        createMockContainer({ id: 'a/one', name: 'one', namespace: 'a', phase: 'running', health: 'ok' }),
        createMockContainer({ id: 'b/two', name: 'two', namespace: 'b', phase: 'failed', health: 'critical' }),
      ],
      mode: 'replace',
    });
    element.paint();

    clickRegion('filter-phase-failed');
    element.paint();
    expect(element.filter.phases).toEqual(['failed']);
    expect(element.viewModel!.cards.filteredTotal).toBe(1);

    clickRegion('filter-phase-all');
    element.paint();
    expect(element.filter.phases).toEqual([]);

    clickRegion('filter-namespace-b');
    element.paint();
    expect(element.filter.namespaces).toEqual(['b']);
    expect(element.viewModel!.cards.filteredTotal).toBe(1);

    clickRegion('action-attention');
    element.paint();
    expect(element.filter.attentionOnly).toBe(true);
    expect(element.viewModel!.cards.filteredTotal).toBe(1);

    clickRegion('action-attention');
    clickRegion('filter-phase-all');
    clickRegion('filter-namespace-b');
    element.paint();
    expect(element.viewModel!.cards.filteredTotal).toBe(2);
  });

  it('drives the DOM search field', () => {
    element.appendBatch({
      timestamp: Date.now(),
      containers: [
        createMockContainer({ id: 'a/gateway', name: 'gateway-1', namespace: 'a' }),
        createMockContainer({ id: 'b/worker', name: 'worker-1', namespace: 'b' }),
      ],
      mode: 'replace',
    });
    element.paint();

    const search = element.shadowRoot!.querySelector('input.search') as HTMLInputElement;
    expect(search.style.display).toBe('block');
    search.value = 'worker';
    search.dispatchEvent(new Event('input'));
    element.paint();

    expect(element.filter.query).toBe('worker');
    expect(element.viewModel!.cards.filteredTotal).toBe(1);
  });

  it('scrolls with the wheel and stays within bounds', () => {
    element.appendBatch(createMockContainerSnapshot({ elapsedSeconds: 33, size: 200 }));
    element.paint();
    const canvas = element.shadowRoot!.querySelector('canvas')!;

    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }));
    element.paint();
    expect(element.viewModel!.cards.scrollTop).toBeGreaterThan(0);

    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100_000, bubbles: true, cancelable: true }));
    element.paint();
    expect(element.viewModel!.cards.scrollTop).toBe(0);
  });

  it('announces health transitions to assistive technology', () => {
    const first = createMockContainer({ id: 'a/pod', name: 'pod', namespace: 'a', health: 'ok' });
    element.appendBatch({ timestamp: Date.now(), containers: [first], mode: 'replace' });

    const transitions: unknown[] = [];
    element.addEventListener('widget-transition', (event) => transitions.push((event as CustomEvent).detail));
    element.appendBatch({
      timestamp: Date.now(),
      containers: [{ ...first, health: 'critical', phase: 'failed' }],
      mode: 'replace',
    });

    expect(transitions).toHaveLength(1);
    expect(element.shadowRoot!.querySelector('[aria-live="polite"]')!.textContent).toContain('critical');
  });

  it('honours attributes, renders headless without a 2D context and streams from the mock fleet', async () => {
    const tag = document.createElement('container-grid') as ContainerGridElement;
    Object.defineProperty(tag, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(tag, 'clientHeight', { value: 700, configurable: true });
    tag.setConfig({ source: () => null });
    tag.setAttribute('locale', 'fa');
    tag.setAttribute('columns', '1');
    tag.setAttribute('phase', 'failed');
    document.body.append(tag);
    tag.appendBatch({
      timestamp: Date.now(),
      containers: [
        createMockContainer({ id: 'a/pod', name: 'pod', namespace: 'a', phase: 'running', health: 'ok' }),
        createMockContainer({ id: 'b/bad', name: 'bad', namespace: 'b', phase: 'failed', health: 'critical' }),
      ],
      mode: 'replace',
    });
    tag.paint();

    expect(tag.currentLayout!.columns).toBe(1);
    expect(tag.filter.phases).toEqual(['failed']);
    expect(tag.viewModel!.toolbar.title).toBe('ناوگان کانتینر');
    expect(tag.viewModel!.cards.filteredTotal).toBe(1);
    tag.remove();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const headless = document.createElement('container-grid') as ContainerGridElement;
    Object.defineProperty(headless, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(headless, 'clientHeight', { value: 600, configurable: true });
    headless.setConfig({ source: () => null });
    document.body.append(headless);
    headless.appendBatch(createMockContainerSnapshot({ elapsedSeconds: 5, size: 6 }));
    headless.paint();

    expect(headless.currentLayout).not.toBeNull();
    expect(headless.viewModel).not.toBeNull();
    expect(headless.hitRegions).toHaveLength(0);
    headless.remove();

    const streamed = document.createElement('container-grid') as ContainerGridElement;
    Object.defineProperty(streamed, 'clientWidth', { value: 1100, configurable: true });
    Object.defineProperty(streamed, 'clientHeight', { value: 700, configurable: true });
    streamed.setConfig({ source: { transport: 'mock', intervalMs: 0, size: 8, incident: true } });
    document.body.append(streamed);
    await Promise.resolve();

    expect(streamed.containerCount).toBeGreaterThan(0);
    streamed.paint();
    expect(streamed.viewModel!.cards.items.length).toBeGreaterThan(0);
    streamed.remove();
    expect(streamed.viewModel).toBeNull();
    expect(streamed.shadowRoot?.children.length ?? 0).toBe(0);
  });
});
