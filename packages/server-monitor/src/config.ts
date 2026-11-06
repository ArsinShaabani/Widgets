import {
  createMockSnapshot,
  createTransport,
  isMockSource as coreIsMockSource,
  isStaticSource as coreIsStaticSource,
  MockTransport,
  normalizeSnapshot,
  type DataTransport,
  type MockSourceDescriptor,
  type Messages,
  type ThresholdConfig,
  type ThemeName,
  type ThemeOverride,
  type ThemeTokens,
  type WidgetSnapshot,
  type WidgetSource as CoreWidgetSource,
} from '@widgets/core';
import type { SectionId } from './layout';

/**
 * Synthetic-source descriptor with the server-monitor specific knobs.
 * The generic source resolution lives in `@widgets/core`.
 */
export interface MockServerSource extends MockSourceDescriptor {
  transport: 'mock';
  /** CPU baseline used by the mock generator, 0..100. */
  cpuBaseline?: number;
  /** Logical core count reported by the mock generator. */
  cores?: number;
  /** Hostname reported by the mock generator. */
  hostname?: string;
}

/**
 * Anything this widget can be pointed at: a transport, a URL, a descriptor,
 * a snapshot, a getter, or `null` for the built-in mock stream.
 */
export type WidgetSource = CoreWidgetSource<WidgetSnapshot> | MockServerSource;

export interface ServerMonitorConfig {
  /** Data source; defaults to the built-in mock stream. */
  source?: WidgetSource;
  theme?: ThemeName | ThemeTokens;
  themeOverride?: ThemeOverride;
  thresholds?: Partial<ThresholdConfig>;
  locale?: string;
  messages?: Messages;
  /** Force a column count; default is responsive (2 columns at ≥ breakpoint). */
  columns?: 1 | 2;
  /** Column collapse breakpoint in CSS px (default 720). */
  breakpoint?: number;
  padding?: number;
  gap?: number;
  /** Hide individual dashboard sections. */
  sections?: Partial<Record<SectionId, boolean>>;
  /** Points kept per history series (default 120). */
  historySize?: number;
  /** Accessible title; defaults to the host name. */
  title?: string;
  /** Show hover tooltips on charts (default true). */
  tooltips?: boolean;
  /** Click handler for the quick-action row and status badges. */
  onAction?: (action: string, payload?: unknown) => void;
  /** Connection problems are reported to the host, never swallowed silently. */
  onError?: (error: Error) => void;
}

export interface ResolvedConfig {
  source: WidgetSource;
  theme: ThemeName | ThemeTokens;
  themeOverride: ThemeOverride;
  thresholds: Partial<ThresholdConfig> | undefined;
  locale: string;
  messages: Messages | undefined;
  columns: 1 | 2 | undefined;
  breakpoint: number;
  padding: number | undefined;
  gap: number | undefined;
  sections: Partial<Record<SectionId, boolean>>;
  historySize: number;
  title: string | undefined;
  tooltips: boolean;
  onAction: ((action: string, payload?: unknown) => void) | undefined;
  onError: ((error: Error) => void) | undefined;
}

export const defaultConfig: ResolvedConfig = {
  source: null,
  theme: 'dark',
  themeOverride: {},
  thresholds: undefined,
  locale: 'en',
  messages: undefined,
  columns: undefined,
  breakpoint: 720,
  padding: undefined,
  gap: undefined,
  sections: {},
  historySize: 120,
  title: undefined,
  tooltips: true,
  onAction: undefined,
  onError: undefined,
};

/** Fills in defaults for a partial config. */
export function resolveConfig(config: ServerMonitorConfig = {}): ResolvedConfig {
  return { ...defaultConfig, ...config };
}

/**
 * True for the built-in synthetic source.
 *
 * `null`/`undefined` means "no explicit source": the widget falls back to the
 * in-process mock stream, which is what the demo and the docs rely on.
 */

/** Re-export of the shared source guards (typed for this widget). */
export const isMockSource = (source: WidgetSource): boolean => coreIsMockSource(source);

export const isStaticSource = (
  source: WidgetSource,
): source is WidgetSnapshot | (() => WidgetSnapshot | null) => coreIsStaticSource(source);

/**
 * Builds the data transport for a source, wiring in the server-metrics
 * normaliser and the synthetic generator.
 *
 * Returns `null` for static sources: the element feeds the store directly
 * instead of polling the network.
 */
export function createServerMonitorTransport(
  source: WidgetSource,
  snapshot: () => WidgetSnapshot | null,
): DataTransport<WidgetSnapshot> | null {
  return createTransport<WidgetSnapshot>(source, {
    normalize: normalizeSnapshot,
    intervalMs: 2000,
    createMock: (descriptor) => {
      const mock = descriptor as MockServerSource | null;
      return new MockTransport<WidgetSnapshot>({
        intervalMs: Number(mock?.intervalMs ?? 1500),
        normalize: normalizeSnapshot,
        factory: () =>
          createMockSnapshot({
            elapsedSeconds: Date.now() / 1000,
            ...(typeof mock?.cpuBaseline === 'number' ? { cpuBaseline: mock.cpuBaseline } : {}),
            ...(typeof mock?.cores === 'number' ? { cores: mock.cores } : {}),
            ...(typeof mock?.hostname === 'string' ? { hostname: mock.hostname } : {}),
            ...(typeof mock?.seed === 'number' ? { seed: mock.seed } : {}),
          }),
      });
    },
  });
}

/** Kept for hosts that want the static-source transport directly. */
export { StaticPollTransport } from '@widgets/core';
