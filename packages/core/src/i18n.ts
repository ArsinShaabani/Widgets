/**
 * Tiny i18n helper.
 *
 * Widgets need to be usable across locales (and the reference design ships
 * placeholder copy), so every string lives in a dictionary keyed by a stable id
 * and can be overridden per widget instance.
 */
export const en = {
  'panel.cpu.title': 'CPU cores',
  'panel.cpu.subtitle': 'Live utilisation per logical core',
  'panel.memory.title': 'Memory',
  'panel.memory.caption': 'Resident vs reclaimable',
  'panel.disk.title': 'Storage',
  'panel.disk.caption': 'Usage by mounted volume',
  'panel.swap.title': 'Swap',
  'panel.swap.caption': 'Swap pressure and headroom',
  'panel.gauges.title': 'Core resources',
  'panel.network.title': 'Network throughput',
  'panel.network.subtitle': 'Ingress and egress over the last minutes',
  'panel.network.received': 'Received',
  'panel.network.sent': 'Sent',
  'host.score': 'Health',
  'host.processes': 'Processes',
  'host.uptime': 'Uptime',
  'host.actions': 'Quick actions',
  'action.settings': 'Settings',
  'action.logs': 'Logs',
  'action.share': 'Share',
  'action.network': 'Network',
  'action.location': 'Node location',
  'action.link': 'Open dashboard',
  'status.live': 'Live',
  'status.connecting': 'Connecting',
  'status.reconnecting': 'Reconnecting',
  'status.error': 'Offline',
  'status.idle': 'Idle',
  'status.closed': 'Stopped',
  'status.no-data': 'Waiting for data',
  'status.updated': 'Updated',
  'metric.cpu': 'CPU',
  'metric.memory': 'Memory',
  'metric.disk': 'Disk',
  'metric.swap': 'Swap',
  'metric.network': 'Network',
  'metric.load': 'Load',
  'metric.latency': 'Latency',
  'metric.temperature': 'Temp',
  'metric.cores': 'cores',
  'metric.used': 'used',
  'metric.free': 'free',
  'metric.of': 'of',
  'unit.perSecond': '/s',
} as const;

export type I18nKey = keyof typeof en;
export type Messages = Partial<Record<I18nKey, string>>;

/** Persian strings — included because the collection targets fa/en deployments. */
export const fa: Messages = {
  'panel.cpu.title': 'هسته‌های CPU',
  'panel.cpu.subtitle': 'میزان مصرف زنده هر هسته منطقی',
  'panel.memory.title': 'حافظه',
  'panel.disk.title': 'فضای ذخیره‌سازی',
  'panel.swap.title': 'سواپ',
  'panel.gauges.title': 'منابع اصلی',
  'panel.network.title': 'ترافیک شبکه',
  'panel.network.received': 'دریافتی',
  'panel.network.sent': 'ارسالی',
  'host.score': 'سلامت',
  'host.processes': 'فرآیندها',
  'host.uptime': 'زمان کارکرد',
  'status.live': 'زنده',
  'status.connecting': 'در حال اتصال',
  'status.reconnecting': 'اتصال مجدد',
  'status.error': 'قطع',
  'status.no-data': 'در انتظار داده',
  'status.updated': 'آخرین به‌روزرسانی',
  'metric.cpu': 'پردازنده',
  'metric.memory': 'حافظه',
  'metric.disk': 'دیسک',
  'metric.swap': 'سواپ',
  'metric.network': 'شبکه',
  'metric.used': 'مصرف',
  'metric.free': 'آزاد',
};

const dictionaries: Record<string, Messages> = { en, fa };

export interface Translator {
  (key: I18nKey, vars?: Record<string, string | number>): string;
  /** Current locale tag. */
  locale: string;
  /** Raw message lookup with fallbacks. */
  raw(key: I18nKey): string;
}

/**
 * Creates a translator for a locale with optional per-instance overrides.
 * Missing keys fall back to English and finally to the key itself.
 */
export function createTranslator(locale = 'en', overrides?: Messages, extra?: Record<string, Messages>): Translator {
  const registry = extra ? { ...dictionaries, ...extra } : dictionaries;
  const primary = registry[locale] ?? {};
  const t = ((key: I18nKey, vars?: Record<string, string | number>) => {
    const template = overrides?.[key] ?? primary[key] ?? en[key] ?? String(key);
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? `{${name}}`));
  }) as Translator;
  t.locale = locale;
  t.raw = (key: I18nKey) => overrides?.[key] ?? primary[key] ?? en[key] ?? String(key);
  return t;
}

export const translations = { en, fa };
