// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockLogSnapshot, type LogEntry } from '@widgets/core';
import { createFakeContext } from '@widgets/render/testing';
import { LogStreamElement, defineLogStream } from '../src/index';

/** Element level tests: upgrade, virtualisation, filters, selection, search, teardown. */

let element: LogStreamElement;

const line = (message: string, level: LogEntry['level'] = 'info', service = 'api'): LogEntry => ({
  id: `${message}-${Math.random().toString(36).slice(2, 8)}`,
  timestamp: Date.now(),
  level,
  service,
  message,
});

beforeEach(() => {
  const fake = createFakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fake as unknown as CanvasRenderingContext2D,
  );
  document.body.innerHTML = '';
  defineLogStream('log-stream');
  element = document.createElement('log-stream') as LogStreamElement;
  Object.defineProperty(element, 'clientWidth', { value: 1240, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: 820, configurable: true });
  // Quiet source configured before connecting, so no synthetic stream starts:
  // tests drive the store directly through appendBatch().
  element.setConfig({ source: () => null });
  document.body.append(element);
});

afterEach(() => {
  element?.remove();
  vi.restoreAllMocks();
});

/** Clicks a hit region by id, simulating the pointer pipeline. */
function clickRegion(id: string): void {
  const region = element.hitRegions.find((item) => item.id === id);
  if (!region) throw new Error(`region ${id} not found`);
  const canvas = element.shadowRoot!.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect);
  const x = region.rect.x + 2;
  const y = region.rect.y + region.rect.height / 2;
  canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }));
  canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y }));
}

describe('LogStreamElement', () => {
  it('upgrades, builds a shadow root with the search field and paints', () => {
    expect(element.shadowRoot).not.toBeNull();
    expect(element.shadowRoot!.querySelector('canvas')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('input.search')).not.toBeNull();

    element.appendBatch({ timestamp: Date.now(), entries: [line('hello')] });
    element.paint();

    expect(element.lineCount).toBe(1);
    expect(element.viewModel?.stream.rows).toHaveLength(1);
    expect(element.currentLayout?.columns).toBe(2);
    expect(element.hitRegions.some((region) => region.id.startsWith('row-'))).toBe(true);
  });

  it('virtualises: a large buffer paints a bounded number of rows', () => {
    element.appendBatch({
      timestamp: Date.now(),
      entries: Array.from({ length: 3000 }, (_, index) => line(`line ${index}`)),
    });
    element.paint();

    expect(element.lineCount).toBe(2000); // ring buffer cap
    const rowRegions = element.hitRegions.filter((region) => region.id.startsWith('row-'));
    expect(rowRegions.length).toBeGreaterThan(10);
    expect(rowRegions.length).toBeLessThan(40);
    expect(element.viewModel!.stream.filteredTotal).toBe(2000);
  });

  it('toggles follow (pause/resume) through the toolbar action', () => {
    element.appendBatch({ timestamp: Date.now(), entries: [line('a')] });
    element.paint();

    clickRegion('action-follow');
    element.paint();
    expect(element.viewModel!.stream.follow).toBe(false);

    clickRegion('action-follow');
    element.paint();
    expect(element.viewModel!.stream.follow).toBe(true);
  });

  it('selects a row on click and emits widget-select', () => {
    const target = line('select me');
    element.appendBatch({ timestamp: Date.now(), entries: [line('first'), target, line('last')] });
    element.paint();

    const selections: LogEntry[] = [];
    element.addEventListener('widget-select', (event) => selections.push((event as CustomEvent).detail));

    const rowRegion = element.hitRegions
      .slice()
      .reverse()
      .find((region) => (region.payload as { id?: string } | undefined)?.id === target.id)!;
    expect(rowRegion).toBeDefined();

    const canvas = element.shadowRoot!.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect);
    const x = rowRegion.rect.x + 20;
    const y = rowRegion.rect.y + rowRegion.rect.height / 2;
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y }));
    element.paint();

    expect(element.selectedId).toBe(target.id);
    expect(selections.map((entry) => entry.id)).toContain(target.id);
    expect(element.viewModel!.detail.entry?.message).toBe('select me');
    expect(element.viewModel!.stream.rows.find((row) => row.id === target.id)!.selected).toBe(true);
  });

  it('applies severity and service filters from chips and from the property', () => {
    element.appendBatch({
      timestamp: Date.now(),
      entries: [line('ok', 'info'), line('bad', 'error'), line('meh', 'warn', 'worker')],
    });
    element.paint();

    clickRegion('filter-level-error');
    element.paint();
    expect(element.filter.levels).toEqual(['error']);
    expect(element.viewModel!.stream.filteredTotal).toBe(1);

    clickRegion('filter-level-all');
    element.paint();
    expect(element.filter.levels).toEqual([]);

    element.filter = { levels: [], services: ['worker'], query: '' };
    element.paint();
    expect(element.viewModel!.stream.filteredTotal).toBe(1);

    element.filter = { levels: [], services: [], query: 'bad' };
    element.paint();
    expect(element.viewModel!.stream.filteredTotal).toBe(1);
  });

  it('drives the DOM search field', () => {
    element.appendBatch({ timestamp: Date.now(), entries: [line('alpha'), line('beta')] });
    element.paint();

    const search = element.shadowRoot!.querySelector('input.search') as HTMLInputElement;
    expect(search.style.display).toBe('block');
    search.value = 'beta';
    search.dispatchEvent(new Event('input'));
    element.paint();

    expect(element.filter.query).toBe('beta');
    expect(element.viewModel!.stream.filteredTotal).toBe(1);

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    element.paint();
    expect(element.filter.query).toBe('');
    expect(element.viewModel!.stream.filteredTotal).toBe(2);
  });

  it('navigates with the keyboard: selection, follow and shortcuts', () => {
    element.appendBatch({
      timestamp: Date.now(),
      entries: Array.from({ length: 80 }, (_, index) => line(`line ${index}`)),
    });
    element.paint();
    const canvas = element.shadowRoot!.querySelector('canvas')!;

    // Selecting a row that is off screen scrolls to it and stops following.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    element.paint();
    const first = element.selectedId;
    expect(first).not.toBeNull();
    expect(element.viewModel!.stream.follow).toBe(false);

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    element.paint();
    expect(element.selectedId).not.toBe(first);

    // Space resumes following the tail.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    element.paint();
    expect(element.viewModel!.stream.follow).toBe(true);

    // End jumps to the newest line and keeps following.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    element.paint();
    expect(element.viewModel!.stream.follow).toBe(true);
    const lastRows = element.viewModel!.stream.rows;
    expect(lastRows[lastRows.length - 1]!.selected).toBe(true);

    // Home jumps back to the oldest line and stops following.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    element.paint();
    expect(element.viewModel!.stream.rows[0]!.selected).toBe(true);
    expect(element.viewModel!.stream.follow).toBe(false);
  });

  it('scrolls with the wheel and stops following when scrolled back', () => {
    element.appendBatch({
      timestamp: Date.now(),
      entries: Array.from({ length: 400 }, (_, index) => line(`line ${index}`)),
    });
    element.paint();

    const canvas = element.shadowRoot!.querySelector('canvas')!;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }));
    element.paint();

    expect(element.viewModel!.stream.scrollTop).toBeGreaterThan(0);
    expect(element.viewModel!.stream.follow).toBe(false);
    expect(element.viewModel!.stream.first).toBeGreaterThan(0);
  });

  it('clears the buffer through the toolbar action', () => {
    element.appendBatch({ timestamp: Date.now(), entries: [line('a'), line('b')] });
    element.paint();
    clickRegion('action-clear');
    element.paint();
    expect(element.lineCount).toBe(0);
    expect(element.selectedId).toBeNull();
  });

  it('emits critical events and announces them for screen readers', () => {
    const critical: LogEntry[] = [];
    element.addEventListener('widget-critical', (event) => critical.push((event as CustomEvent).detail));
    element.appendBatch({ timestamp: Date.now(), entries: [line('kaboom', 'error')] });
    expect(critical).toHaveLength(1);
    expect(element.shadowRoot!.querySelector('[aria-live="polite"]')!.textContent).toContain('kaboom');
  });

  it('honours attributes and config (locale, columns, level, hidden sections)', () => {
    const tag = document.createElement('log-stream') as LogStreamElement;
    Object.defineProperty(tag, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(tag, 'clientHeight', { value: 700, configurable: true });
    // Deterministic source: the synthetic stream must not add lines mid-assertion.
    tag.setConfig({ source: () => null });
    tag.setAttribute('locale', 'fa');
    tag.setAttribute('columns', '1');
    tag.setAttribute('level', 'error');
    document.body.append(tag);
    tag.appendBatch({ timestamp: Date.now(), entries: [line('a', 'info'), line('b', 'error')] });
    tag.paint();

    expect(tag.currentLayout!.columns).toBe(1);
    expect(tag.filter.levels).toEqual(['error']);
    expect(tag.viewModel!.toolbar.title).toBe('جریان زنده لاگ');
    expect(tag.viewModel!.stream.filteredTotal).toBe(1);

    tag.setConfig({ sections: { histogram: false }, theme: 'light', searchable: false });
    tag.paint();
    expect(tag.viewModel!.hidden.has('histogram')).toBe(true);
    tag.remove();
  });

  it('renders a headless frame when no 2D context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const headless = document.createElement('log-stream') as LogStreamElement;
    Object.defineProperty(headless, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(headless, 'clientHeight', { value: 700, configurable: true });
    document.body.append(headless);
    headless.appendBatch({ timestamp: Date.now(), entries: [line('a')] });
    headless.paint();

    expect(headless.currentLayout).not.toBeNull();
    expect(headless.viewModel).not.toBeNull();
    expect(headless.hitRegions).toHaveLength(0);
    headless.remove();
  });

  it('streams from the in-process mock source and tears down cleanly', async () => {
    const tag = document.createElement('log-stream') as LogStreamElement;
    Object.defineProperty(tag, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(tag, 'clientHeight', { value: 700, configurable: true });
    tag.setConfig({ source: { transport: 'mock', intervalMs: 0, count: 6 } });
    document.body.append(tag);
    await Promise.resolve();

    expect(tag.lineCount).toBeGreaterThan(0);
    tag.paint();
    expect(tag.viewModel!.stream.rows.length).toBeGreaterThan(0);

    tag.remove();
    expect(tag.viewModel).toBeNull();
    expect(tag.shadowRoot?.children.length ?? 0).toBe(0);
  });

  it('copies the filtered view to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
    element.appendBatch(createMockLogSnapshot({ elapsedSeconds: 21, count: 5 }));
    element.paint();

    expect(await element.copySelection()).toBe(true);
    expect(writeText).toHaveBeenCalled();
    const written = String(writeText.mock.calls[0]![0]);
    expect(written.split('\n').length).toBeGreaterThan(0);
    expect(written).toMatch(/INFO|WARN|ERROR|FATAL|DEBUG|TRACE/);
  });
});

