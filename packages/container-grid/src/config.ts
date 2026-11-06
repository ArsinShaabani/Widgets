import {
  createMockContainerSnapshot,
  createTransport,
  isMockSource as coreIsMockSource,
  isStaticSource as coreIsStaticSource,
  MockTransport,
  normalizeContainerSnapshot,
  type ContainerFilter,
  type ContainerSnapshot,
  type DataTransport,
  type Messages,
  type MockSourceDescriptor,
  type ThemeName,
  type ThemeOverride,
  type ThemeTokens,
  type WidgetSource as CoreWidgetSource,
} from '@widgets/core';
import type { GridSectionId } from './layout';

/** Synthetic-source descriptor with the fleet generator's knobs. */
export interface MockContainerSource extends MockSourceDescriptor {
  transport: 'mock';
  /** Fleet size (default 24). */
  size?: number;
  /** Force an incident window (pending/failed pods). */
  incident?: boolean;
  namespaces?: string[];
  nodes?: string[];
}

/**
 * Anything this widget can be pointed at: a transport, a URL, a descriptor, a
 * `ContainerSnapshot`, a getter, or `null` for the built-in mock fleet.
 */
export type WidgetSource = CoreWidgetSource<ContainerSnapshot> | MockContainerSource;

export interface ContainerGridConfig {
  /** Data source; defaults to the built-in mock fleet. */
  source?: WidgetSource;
  theme?: ThemeName | ThemeTokens;
  themeOverride?: ThemeOverride;
  locale?: string;
  messages?: Messages;
  /** Maximum tracked containers (default 400). */
  maxContainers?: number;
  /** Sparkline samples per card (default 24). */
  historySize?: number;
  /** Minimum card width in CSS px; the grid fits as many columns as possible (default 246). */
  cardMinWidth?: number;
  /** Card height in CSS px (default 132). */
  cardHeight?: number;
  /** Gap between cards (default 12). */
  cardGap?: number;
  /** Initial filter state. */
  filters?: Partial<ContainerFilter>;
  /** Force a column count for the whole widget; default is responsive. */
  columns?: 1 | 2;
  /** Column collapse breakpoint in CSS px (default 1020). */
  breakpoint?: number;
  padding?: number;
  gap?: number;
  sections?: Partial<Record<GridSectionId, boolean>>;
  tooltips?: boolean;
  searchable?: boolean;
  /** Sort order inside the grid (default: most severe first). */
  sort?: 'severity' | 'name' | 'restarts' | 'cpu' | 'memory';
  onAction?: (action: string, payload?: unknown) => void;
  onError?: (error: Error) => void;
}

export interface ResolvedConfig {
  source: WidgetSource;
  theme: ThemeName | ThemeTokens;
  themeOverride: ThemeOverride;
  locale: string;
  messages: Messages | undefined;
  maxContainers: number;
  historySize: number;
  cardMinWidth: number;
  cardHeight: number;
  cardGap: number;
  filters: Partial<ContainerFilter>;
  columns: 1 | 2 | undefined;
  breakpoint: number;
  padding: number | undefined;
  gap: number | undefined;
  sections: Partial<Record<GridSectionId, boolean>>;
  tooltips: boolean;
  searchable: boolean;
  sort: NonNullable<ContainerGridConfig['sort']>;
  onAction: ((action: string, payload?: unknown) => void) | undefined;
  onError: ((error: Error) => void) | undefined;
}

export const defaultConfig: ResolvedConfig = {
  source: null,
  theme: 'dark',
  themeOverride: {},
  locale: 'en',
  messages: undefined,
  maxContainers: 400,
  historySize: 24,
  cardMinWidth: 246,
  cardHeight: 132,
  cardGap: 12,
  filters: {},
  columns: undefined,
  breakpoint: 1020,
  padding: undefined,
  gap: undefined,
  sections: {},
  tooltips: true,
  searchable: true,
  sort: 'severity',
  onAction: undefined,
  onError: undefined,
};

/** Fills in defaults for a partial config. */
export function resolveConfig(config: ContainerGridConfig = {}): ResolvedConfig {
  return { ...defaultConfig, ...config };
}

/** Re-export of the shared source guards (typed for this widget). */
export const isMockSource = (source: WidgetSource): boolean => coreIsMockSource(source);

export const isStaticSource = (
  source: WidgetSource,
): source is ContainerSnapshot | (() => ContainerSnapshot | null) => coreIsStaticSource(source);

/**
 * Builds the data transport for a source, wiring in the container normaliser and
 * the synthetic fleet generator.
 */
export function createContainerGridTransport(
  source: WidgetSource,
  snapshot: () => ContainerSnapshot | null,
): DataTransport<ContainerSnapshot> | null {
  return createTransport<ContainerSnapshot>(source, {
    normalize: normalizeContainerSnapshot,
    intervalMs: 3000,
    createMock: (descriptor) => {
      const mock = descriptor as MockContainerSource | null;
      return new MockTransport<ContainerSnapshot>({
        intervalMs: Number(mock?.intervalMs ?? 3000),
        normalize: normalizeContainerSnapshot,
        factory: () =>
          createMockContainerSnapshot({
            elapsedSeconds: Date.now() / 1000,
            ...(typeof mock?.size === 'number' ? { size: mock.size } : {}),
            ...(typeof mock?.incident === 'boolean' ? { incident: mock.incident } : {}),
            ...(Array.isArray(mock?.namespaces) ? { namespaces: mock.namespaces as string[] } : {}),
            ...(Array.isArray(mock?.nodes) ? { nodes: mock.nodes as string[] } : {}),
            ...(typeof mock?.seed === 'number' ? { seed: mock.seed } : {}),
          }),
      });
    },
  });
}

