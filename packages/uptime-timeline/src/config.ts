import {
  createMockUptimeSnapshot,
  createTransport,
  isMockSource as coreIsMockSource,
  isStaticSource as coreIsStaticSource,
  MockTransport,
  normalizeUptimeSnapshot,
  type DataTransport,
  type Messages,
  type MockSourceDescriptor,
  type ThemeName,
  type ThemeOverride,
  type ThemeTokens,
  type UptimeFilter,
  type UptimeSnapshot,
  type WidgetSource as CoreWidgetSource,
} from '@widgets/core';
import type { TimelineSectionId } from './layout';

/** Synthetic-source descriptor with the status-page generator's knobs. */
export interface MockUptimeSource extends MockSourceDescriptor {
  transport: 'mock';
  /** Services to generate (default 8). */
  size?: number;
  /** History window in days (default 90). */
  windowDays?: number;
  /** Force an open major outage. */
  incident?: boolean;
}

/**
 * Anything this widget can be pointed at: a transport, a URL, a descriptor, an
 * `UptimeSnapshot`, a getter, or `null` for the built-in mock status page.
 */
export type WidgetSource = CoreWidgetSource<UptimeSnapshot> | MockUptimeSource;

export interface UptimeTimelineConfig {
  /** Data source; defaults to the built-in mock status page. */
  source?: WidgetSource;
  theme?: ThemeName | ThemeTokens;
  themeOverride?: ThemeOverride;
  locale?: string;
  messages?: Messages;
  /** History window kept per service, in days (default 90). */
  windowDays?: number;
  /** Maximum incidents kept (default 200). */
  maxIncidents?: number;
  /** Height of a timeline row in CSS px (default 30). */
  rowHeight?: number;
  /** Width of one day cell in CSS px (default 11). */
  cellWidth?: number;
  /** Initial filter state. */
  filters?: Partial<UptimeFilter>;
  /** Force a column count for the whole widget; default is responsive. */
  columns?: 1 | 2;
  /** Column collapse breakpoint in CSS px (default 1080). */
  breakpoint?: number;
  padding?: number;
  gap?: number;
  sections?: Partial<Record<TimelineSectionId, boolean>>;
  tooltips?: boolean;
  searchable?: boolean;
  onAction?: (action: string, payload?: unknown) => void;
  onError?: (error: Error) => void;
}

export interface ResolvedConfig {
  source: WidgetSource;
  theme: ThemeName | ThemeTokens;
  themeOverride: ThemeOverride;
  locale: string;
  messages: Messages | undefined;
  windowDays: number;
  maxIncidents: number;
  rowHeight: number;
  cellWidth: number;
  filters: Partial<UptimeFilter>;
  columns: 1 | 2 | undefined;
  breakpoint: number;
  padding: number | undefined;
  gap: number | undefined;
  sections: Partial<Record<TimelineSectionId, boolean>>;
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
  windowDays: 90,
  maxIncidents: 200,
  rowHeight: 30,
  cellWidth: 11,
  filters: {},
  columns: undefined,
  breakpoint: 1080,
  padding: undefined,
  gap: undefined,
  sections: {},
  tooltips: true,
  searchable: true,
  onAction: undefined,
  onError: undefined,
};

/** Fills in defaults for a partial config. */
export function resolveConfig(config: UptimeTimelineConfig = {}): ResolvedConfig {
  return { ...defaultConfig, ...config };
}

/** Re-export of the shared source guards (typed for this widget). */
export const isMockSource = (source: WidgetSource): boolean => coreIsMockSource(source);

export const isStaticSource = (
  source: WidgetSource,
): source is UptimeSnapshot | (() => UptimeSnapshot | null) => coreIsStaticSource(source);

/**
 * Builds the data transport for a source, wiring in the uptime normaliser and the
 * synthetic status-page generator.
 */
export function createUptimeTransport(
  source: WidgetSource,
  snapshot: () => UptimeSnapshot | null,
): DataTransport<UptimeSnapshot> | null {
  return createTransport<UptimeSnapshot>(source, {
    normalize: normalizeUptimeSnapshot,
    intervalMs: 30_000,
    createMock: (descriptor) => {
      const mock = descriptor as MockUptimeSource | null;
      return new MockTransport<UptimeSnapshot>({
        intervalMs: Number(mock?.intervalMs ?? 30_000),
        normalize: normalizeUptimeSnapshot,
        factory: () =>
          createMockUptimeSnapshot({
            ...(typeof mock?.size === 'number' ? { size: mock.size } : {}),
            ...(typeof mock?.windowDays === 'number' ? { windowDays: mock.windowDays } : {}),
            ...(typeof mock?.incident === 'boolean' ? { incident: mock.incident } : {}),
            ...(typeof mock?.seed === 'number' ? { seed: mock.seed } : {}),
          }),
      });
    },
  });
}
