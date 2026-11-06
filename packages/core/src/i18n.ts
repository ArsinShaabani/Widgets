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

  // ── log stream widget ────────────────────────────────────────────────────
  'log.title': 'Live log stream',
  'log.subtitle': 'Streaming lines from every service in the fleet',
  'log.search': 'Filter lines…',
  'log.all': 'All',
  'log.level.all': 'All levels',
  'log.empty': 'No lines match the current filters',
  'log.waiting': 'Waiting for the first line',
  'log.follow': 'Following',
  'log.paused': 'Paused',
  'log.pause': 'Pause',
  'log.resume': 'Resume',
  'log.clear': 'Clear',
  'log.copy': 'Copy line',
  'log.detail': 'Selected line',
  'log.detail.empty': 'Select a line to inspect its attributes',
  'log.volume': 'Volume by severity',
  'log.volume.subtitle': 'Lines per second over the last minute',
  'log.services': 'Services',
  'log.services.subtitle': 'Share of the buffered lines',
  'log.rate': 'Errors / s',
  'log.received': 'received',
  'log.buffered': 'buffered',
  'log.repeated': 'repeated {count}×',
  'log.attr': 'Attributes',
  'log.collapse': 'Collapse repeated lines',
  'log.total': 'Total',

  // ── container grid widget ────────────────────────────────────────────────
  'grid.title': 'Container fleet',
  'grid.subtitle': 'Pod and service health across the cluster',
  'grid.containers': 'workloads',
  'grid.attention': 'Needs attention',
  'grid.refresh': 'Refresh',
  'grid.copy': 'Copy state',
  'grid.empty': 'No workloads match the current filters',
  'grid.detail': 'Inspector',
  'grid.detail.empty': 'Select a workload to inspect its containers, image and limits',
  'grid.noLimit': 'no limit',

  // ── uptime timeline widget ───────────────────────────────────────────────
  'uptime.title': 'Service reliability',
  'uptime.subtitle': 'Availability, SLOs and incident history',
  'uptime.services': 'services',
  'uptime.window': 'window',
  'uptime.overall': 'Overall availability',
  'uptime.belowSlo': 'below SLO',
  'uptime.openIncidents': 'open incidents',
  'uptime.attention': 'Needs attention',
  'uptime.refresh': 'Refresh',
  'uptime.empty': 'No services match the current filters',
  'uptime.timeline': 'Availability timeline',
  'uptime.timelineHint': 'worst state per day',
  'uptime.incidents': 'Incidents',
  'uptime.incidents.open': 'Open',
  'uptime.incidents.resolved': 'Resolved',
  'uptime.incidents.empty': 'No incidents in the window',
  'uptime.slo': 'SLO & error budget',
  'uptime.slo.target': 'target',
  'uptime.slo.budget': 'budget used',
  'uptime.detail': 'Incident detail',
  'uptime.detail.empty': 'Select a service or incident to inspect the timeline',
  'uptime.mttr': 'MTTR',
  'uptime.mtbf': 'MTBF',
  'uptime.checkpoints': 'checkpoints',
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
  'log.title': 'جریان زنده لاگ',
  'log.search': 'فیلتر خطوط…',
  'log.all': 'همه',
  'log.level.all': 'همه سطوح',
  'log.empty': 'خطی با این فیلترها پیدا نشد',
  'log.waiting': 'در انتظار اولین خط',
  'log.follow': 'دنبال‌کردن',
  'log.paused': 'متوقف',
  'log.pause': 'توقف',
  'log.resume': 'ادامه',
  'log.clear': 'پاک‌سازی',
  'log.copy': 'کپی خط',
  'log.detail': 'خط انتخاب‌شده',
  'log.volume': 'حجم بر اساس سطح',
  'log.services': 'سرویس‌ها',
  'log.rate': 'خطا بر ثانیه',
  'log.received': 'دریافت‌شده',
  'log.buffered': 'در بافر',
  'log.repeated': '{count}× تکرار',
  'log.attr': 'ویژگی‌ها',
  'log.total': 'کل',
  'grid.title': 'ناوگان کانتینر',
  'grid.subtitle': 'سلامت پادها و سرویس‌ها در کل کلاستر',
  'grid.containers': 'بارِ کاری',
  'grid.attention': 'نیازمند بررسی',
  'grid.refresh': 'به‌روزرسانی',
  'grid.copy': 'کپی وضعیت',
  'grid.empty': 'با این فیلترها موردی پیدا نشد',
  'grid.detail': 'بازرس',
  'grid.detail.empty': 'یک بارِ کاری را انتخاب کنید تا کانتینرها، ایمیج و محدودیت‌ها را ببینید',
  'grid.noLimit': 'بدون محدودیت',
  'uptime.title': 'پایداری سرویس',
  'uptime.subtitle': 'دسترس‌پذیری، SLO و تاریخچهٔ حادثه‌ها',
  'uptime.services': 'سرویس',
  'uptime.window': 'بازه',
  'uptime.overall': 'دسترس‌پذیری کل',
  'uptime.belowSlo': 'زیر SLO',
  'uptime.openIncidents': 'حادثهٔ باز',
  'uptime.attention': 'نیازمند بررسی',
  'uptime.refresh': 'به‌روزرسانی',
  'uptime.empty': 'با این فیلترها سرویسی پیدا نشد',
  'uptime.timeline': 'خط زمانی دسترس‌پذیری',
  'uptime.timelineHint': 'بدترین وضعیت هر روز',
  'uptime.incidents': 'حادثه‌ها',
  'uptime.incidents.open': 'باز',
  'uptime.incidents.resolved': 'بسته‌شده',
  'uptime.incidents.empty': 'حادثه‌ای در این بازه نیست',
  'uptime.slo': 'SLO و بودجهٔ خطا',
  'uptime.slo.target': 'هدف',
  'uptime.slo.budget': 'بودجهٔ مصرف‌شده',
  'uptime.detail': 'جزئیات حادثه',
  'uptime.detail.empty': 'یک سرویس یا حادثه را انتخاب کنید',
  'uptime.mttr': 'میانگین زمان رفع',
  'uptime.mtbf': 'میانگین فاصلهٔ خرابی',
  'uptime.checkpoints': 'نقطهٔ بررسی',
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
