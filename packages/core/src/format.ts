/** Locale-aware value formatting used across every widget. */

const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;
const SI_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;

export interface ByteFormatOptions {
  /** Number of decimals, default 1 (0 for whole bytes). */
  precision?: number;
  /** Use SI (1000) units instead of binary (1024). */
  si?: boolean;
  /** Locale passed to `Number.toLocaleString`. */
  locale?: string;
}

function formatScaled(value: number, units: readonly string[], precision: number, locale?: string) {
  const abs = Math.abs(value);
  let index = 0;
  let scaled = abs;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const decimals = index === 0 ? 0 : precision;
  const sign = value < 0 ? '-' : '';
  const text = scaled.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}${text} ${units[index]}`;
}

/** `1536` → `"1.5 KiB"`. */
export function formatBytes(bytes: number, options: ByteFormatOptions = {}): string {
  if (!Number.isFinite(bytes)) return '—';
  const { precision = 1, si = false, locale } = options;
  return formatScaled(bytes, si ? SI_UNITS : BINARY_UNITS, precision, locale);
}

/** `1572864` → `"1.5 MiB/s"`. */
export function formatRate(bytesPerSecond: number, options: ByteFormatOptions = {}): string {
  if (!Number.isFinite(bytesPerSecond)) return '—';
  return `${formatBytes(bytesPerSecond, options)}/s`;
}

/** `92.4` → `"92.4%"`; `percent(92.4, 0)` → `"92%"`. */
export function formatPercent(value: number, precision = 1, locale?: string): string {
  if (!Number.isFinite(value)) return '—';
  const clamped = Math.min(100, Math.max(0, value));
  return `${clamped.toLocaleString(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })}%`;
}

/** `3672` → `"1h 1m"`; long form `"1 hour 1 minute"`. */
export function formatUptime(seconds: number, style: 'short' | 'long' = 'short'): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const short = style === 'short';
  const parts: string[] = [];
  if (days > 0) parts.push(short ? `${days}d` : `${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(short ? `${hours}h` : `${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0 && days === 0) parts.push(short ? `${minutes}m` : `${minutes} minute${minutes > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' ') : short ? '<1m' : 'less than a minute';
}

/** `1240` → `"1.2k"`, `2400000` → `"2.4M"`. */
export function compactNumber(value: number, precision = 1, locale?: string): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      const scaled = abs / threshold;
      return `${sign}${scaled.toLocaleString(locale, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      })}${suffix}`;
    }
  }
  return `${sign}${abs.toLocaleString(locale, { maximumFractionDigits: precision })}`;
}

/** Rounds a value up to a "nice" axis maximum (1, 2, 5 × 10^n). */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Formats a duration in ms as `"42 ms"` / `"1.2 s"`. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
