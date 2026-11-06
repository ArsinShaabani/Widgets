import {
  createMockLogSnapshot,
  createTransport,
  isMockSource as coreIsMockSource,
  isStaticSource as coreIsStaticSource,
  MockTransport,
  normalizeLogSnapshot,
  type DataTransport,
  type LogFilter,
  type LogSnapshot,
  type Messages,
  type MockSourceDescriptor,
  type ThemeName,
  type ThemeOverride,
  type ThemeTokens,
  type WidgetSource as CoreWidgetSource,
} from '@widgets/core';
import type { LogSectionId } from './layout';

/**
 * Synthetic-source descriptor with the log generator's knobs.
 * The generic source resolution lives in `@widgets/core`.
 */
export interface MockLogSource extends MockSourceDescriptor {
  transport: 'mock';
  /** Lines per batch (default 4). */
  count?: number;
  /** Force an incident burst (warnings/errors). */
  burst?: boolean;
  /** Services that may appear. */
  services?: string[];
  /** Hostname stamped on synthetic lines. */
  hostname?: string;
}

/**
 * Anything the log widget can be pointed at: a transport, a URL, a descriptor,
 * a `LogSnapshot`, a getter, or `null` for the built-in mock stream.
 */
export type WidgetSource = CoreWidgetSource<LogSnapshot> | MockLogSource;

export interface LogStreamConfig {
  /** Data source; defaults to the built-in mock stream. */
  source?: WidgetSource;
  theme?: ThemeName | ThemeTokens;
  themeOverride?: ThemeOverride;
  locale?: string;
  messages?: Messages;
  /** Buffered lines kept in memory (default 2000). */
  maxEntries?: number;
  /** Histogram bucket width in ms (default 1000). */
  bucketMs?: number;
  /** Histogram buckets kept (default 60). */
  bucketCount?: number;
  /** Row height in CSS px (default 26). */
  rowHeight?: number;
  /** Extra rows rendered outside the viewport (default 4). */
  overscanRows?: number;
  /** Collapse identical consecutive lines (default true). */
  collapseRepeats?: boolean;
  /** Follow the tail as new lines arrive (default true). */
  follow?: boolean;
  /** Initial filter state. */
  filters?: Partial<LogFilter>;
  /** Force a column count; default is responsive (2 columns ≥ breakpoint). */
  columns?: 1 | 2;
  /** Column collapse breakpoint in CSS px (default 900). */
  breakpoint?: number;
  padding?: number;
  gap?: number;
  /** Hide individual dashboard sections. */
  sections?: Partial<Record<LogSectionId, boolean>>;
  /** Show hover tooltips (default true). */
  tooltips?: boolean;
  /** Render a DOM search field above the stream (default true). */
  searchable?: boolean;
  /** Click handler for toolbar/row affordances. */
  onAction?: (action: string, payload?: unknown) => void;
  /** Connection problems are reported to the host. */
  onError?: (error: Error) => void;
}

export interface ResolvedConfig {
  source: WidgetSource;
  theme: ThemeName | ThemeTokens;
  themeOverride: ThemeOverride;
  locale: string;
  messages: Messages | undefined;
  maxEntries: number;
  bucketMs: number;
  bucketCount: number;
  rowHeight: number;
  overscanRows: number;
  collapseRepeats: boolean;
  follow: boolean;
  filters: Partial<LogFilter>;
  columns: 1 | 2 | undefined;
  breakpoint: number;
  padding: number | undefined;
  gap: number | undefined;
  sections: Partial<Record<LogSectionId, boolean>>;
  tooltips: boolean;
  searchable: boolean;
  onAction: ((action: string, payload?: unknown) => void) | undefined;
  onError: ((error: Error) => void) | undefined;
}

export const defaultConfig: ResolvedConfig = {
  source: null,
  theme: 'dark',
  themeOverride: {},
  locale: 'en',
  messages: undefined,
  maxEntries: 2000,
  bucketMs: 1000,
  bucketCount: 60,
  rowHeight: 26,
  overscanRows: 4,
  collapseRepeats: true,
  follow: true,
  filters: {},
  columns: undefined,
  breakpoint: 900,
  padding: undefined,
  gap: undefined,
  sections: {},
  tooltips: true,
  searchable: true,
  onAction: undefined,
  onError: undefined,
};

/** Fills in defaults for a partial config. */
/** Re-export of the shared source guards (typed for this widget). */
export const isMockSource = (source: WidgetSource): boolean => coreIsMockSource(source);

export const isStaticSource = (
  source: WidgetSource,
): source is LogSnapshot | (() => LogSnapshot | null) => coreIsStaticSource(source);

/**
 * Builds the data transport for a source, wiring in the log normaliser and the
 * synthetic log generator.
 */
export function createLogStreamTransport(
  source: WidgetSource,
  snapshot: () => LogSnapshot | null,
): DataTransport<LogSnapshot> | null {
  return createTransport<LogSnapshot>(source, {
    normalize: normalizeLogSnapshot,
    intervalMs: 2000,
    createMock: (descriptor) => {
      const mock = descriptor as MockLogSource | null;
      return new MockTransport<LogSnapshot>({
        intervalMs: Number(mock?.intervalMs ?? 1500),
        normalize: normalizeLogSnapshot,
        factory: () =>
          createMockLogSnapshot({
            elapsedSeconds: Date.now() / 1000,
            ...(typeof mock?.count === 'number' ? { count: mock.count } : {}),
            ...(typeof mock?.burst === 'boolean' ? { burst: mock.burst } : {}),
            ...(Array.isArray(mock?.services) ? { services: mock.services as string[] } : {}),
            ...(typeof mock?.hostname === 'string' ? { hostname: mock.hostname } : {}),
            ...(typeof mock?.seed === 'number' ? { seed: mock.seed } : {}),
          }),
      });
    },
  });
}

export function resolveConfig(config: LogStreamConfig = {}): ResolvedConfig {
  return { ...defaultConfig, ...config };
}
