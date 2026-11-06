import type { LogLevel } from './log-types';
import type { StatusLevel } from './types';

/**
 * Design tokens extracted from the reference dashboard mock-up.
 *
 * The palette is intentionally centralised here so the same visual language can
 * be reused by the canvas renderer, the native host shells and any future
 * renderer (SVG, Compose, SwiftUI) without re-inventing colours.
 */
export interface ThemeTokens {
  name: string;
  /** Page background behind the panels. */
  background: string;
  /** Panel surface + a slightly lighter top edge (mock-up uses a subtle sheen). */
  surface: string;
  surfaceRaised: string;
  /** Hairline borders / separators. */
  border: string;
  /** Primary copy. */
  text: string;
  /** Secondary copy (captions, axis labels). */
  textMuted: string;
  /** Tertiary copy / disabled. */
  textFaint: string;
  /** Track colour behind every progress bar and gauge. */
  track: string;
  /** Ordered accent series used by charts (blue, magenta, cyan, ...). */
  accents: string[];
  /** Gradient stops: [start, middle, end] as the mock-up's bars ascend. */
  gradient: [string, string, string];
  /** Area chart gradient (dark teal panel + bright edge stroke). */
  areaFill: [string, string];
  areaStroke: string;
  /** Notification badge. */
  badge: string;
  /** Status colours. */
  status: Record<StatusLevel, string>;
  /** Log severity colours (log-stream widget, severity rails, legends). */
  levels: Record<LogLevel, string>;
  /** Soft versions of the status colours for glows/rings. */
  statusSoft: Record<StatusLevel, string>;
}

/** Dark theme — the exact palette of the reference mock-up. */
export const darkTheme: ThemeTokens = {
  name: 'dark',
  background: '#151c2b',
  surface: '#1e2637',
  surfaceRaised: '#242e42',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#ffffff',
  textMuted: '#8f9bb3',
  textFaint: '#5f6b83',
  track: '#2f3950',
  accents: ['#2f7bf6', '#e0379b', '#17c3d8', '#8b5cf6', '#f5a524'],
  gradient: ['#b03aec', '#7b3fe4', '#3f6cf0'],
  areaFill: ['#0d3f3a', '#082027'],
  areaStroke: '#1fd0c4',
  badge: '#e94b5c',
  status: {
    ok: '#1fd0c4',
    warning: '#f5a524',
    critical: '#e94b5c',
    unknown: '#5f6b83',
  },
  statusSoft: {
    ok: 'rgba(31, 208, 196, 0.18)',
    warning: 'rgba(245, 165, 36, 0.18)',
    critical: 'rgba(233, 75, 92, 0.18)',
    unknown: 'rgba(95, 107, 131, 0.18)',
  },
  levels: {
    trace: '#6b7794',
    debug: '#5f8bff',
    info: '#1fd0c4',
    warn: '#f5a524',
    error: '#e94b5c',
    fatal: '#ff4d6d',
  },
};

/** Light variant of the same design language (day mode). */
export const lightTheme: ThemeTokens = {
  name: 'light',
  background: '#eef1f7',
  surface: '#ffffff',
  surfaceRaised: '#f6f8fc',
  border: 'rgba(21, 28, 43, 0.10)',
  text: '#151c2b',
  textMuted: '#5f6b83',
  textFaint: '#98a2b8',
  track: '#e2e7f0',
  accents: ['#2563eb', '#d6247f', '#0fa8bc', '#7c3aed', '#e08b0a'],
  gradient: ['#a22ae0', '#6a32dc', '#2f5ce0'],
  areaFill: ['#d6f5f2', '#eef1f7'],
  areaStroke: '#0fa8bc',
  badge: '#e94b5c',
  status: {
    ok: '#0fa8bc',
    warning: '#e08b0a',
    critical: '#d93b4c',
    unknown: '#98a2b8',
  },
  statusSoft: {
    ok: 'rgba(15, 168, 188, 0.16)',
    warning: 'rgba(224, 139, 10, 0.16)',
    critical: 'rgba(217, 59, 76, 0.16)',
    unknown: 'rgba(152, 162, 184, 0.16)',
  },
  levels: {
    trace: '#98a2b8',
    debug: '#2563eb',
    info: '#0fa8bc',
    warn: '#e08b0a',
    error: '#d93b4c',
    fatal: '#b81f45',
  },
};

export const themes = {
  dark: darkTheme,
  light: lightTheme,
} as const;

export type ThemeName = keyof typeof themes;

/** Partial token override accepted by every widget config. */
export type ThemeOverride = Partial<Omit<ThemeTokens, 'status' | 'statusSoft' | 'levels'>> & {
  status?: Partial<Record<StatusLevel, string>>;
  statusSoft?: Partial<Record<StatusLevel, string>>;
  levels?: Partial<Record<LogLevel, string>>;
};

/** Resolve a theme name (or a full token set) into tokens, applying overrides. */
export function resolveTheme(
  theme: ThemeName | ThemeTokens = 'dark',
  override?: ThemeOverride,
): ThemeTokens {
  const base = typeof theme === 'string' ? themes[theme] ?? darkTheme : theme;
  if (!override) return base;
  return {
    ...base,
    ...override,
    accents: override.accents ?? base.accents,
    gradient: override.gradient ?? base.gradient,
    areaFill: override.areaFill ?? base.areaFill,
    status: { ...base.status, ...(override.status ?? {}) },
    statusSoft: { ...base.statusSoft, ...(override.statusSoft ?? {}) },
    levels: { ...base.levels, ...(override.levels ?? {}) },
  };
}

/** Hex `#rrggbb` (or `#rgb`) to `[r, g, b]` tuple. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear interpolation between two hex colours; `t` in 0..1. */
export function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const k = Math.min(1, Math.max(0, t));
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Add an alpha channel to a hex colour. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}
