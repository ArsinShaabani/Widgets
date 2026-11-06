import type { StatusLevel, ThresholdConfig, ThresholdRule, WidgetSnapshot } from './types';

/** Default thresholds for server monitoring (all percentages / ms). */
export const defaultThresholds: ThresholdConfig = {
  cpu: { warning: 70, critical: 90 },
  memory: { warning: 80, critical: 92 },
  disk: { warning: 80, critical: 90 },
  latency: { warning: 120, critical: 300 },
  swap: { warning: 25, critical: 60 },
};

/** Classify a raw value against a single threshold rule. */
export function classify(value: number, rule: ThresholdRule): StatusLevel {
  if (!Number.isFinite(value)) return 'unknown';
  if (value >= rule.critical) return 'critical';
  if (value >= rule.warning) return 'warning';
  return 'ok';
}

const SEVERITY_RANK: Record<StatusLevel, number> = {
  unknown: -1,
  ok: 0,
  warning: 1,
  critical: 2,
};

/** Worst status of a list, ignoring `unknown` unless everything is unknown. */
export function worstStatus(statuses: readonly StatusLevel[]): StatusLevel {
  let worst: StatusLevel = 'unknown';
  for (const status of statuses) {
    if (SEVERITY_RANK[status] > SEVERITY_RANK[worst]) worst = status;
  }
  return worst;
}

/** Percentage of swap in use, 0 when there is no swap configured. */
export function swapUsagePercent(swapUsed: number, swapTotal: number): number {
  if (!swapTotal || swapTotal <= 0) return 0;
  return Math.min(100, Math.max(0, (swapUsed / swapTotal) * 100));
}

/**
 * Composite health score (0..100) and letter grade.
 *
 * CPU and memory dominate the score, disk pressure is penalised harder because
 * a full disk is terminal, and active alerts subtract a documented penalty so
 * the number in the host card is explainable.
 */
export function computeHealth(
  snapshot: Omit<WidgetSnapshot, 'health'>,
  thresholds: ThresholdConfig = defaultThresholds,
): WidgetSnapshot['health'] {
  const cpuPenalty = severityPenalty(classify(snapshot.cpu.usage, thresholds.cpu));
  const memPenalty = severityPenalty(classify(snapshot.memory.usage, thresholds.memory));
  const diskPenalty = severityPenalty(classify(snapshot.disk.usage, thresholds.disk)) * 1.25;
  const swapPenalty =
    severityPenalty(
      classify(swapUsagePercent(snapshot.memory.swapUsed, snapshot.memory.swapTotal), thresholds.swap),
    ) * 0.5;
  const loadPressure = snapshot.cpu.cores > 0 ? snapshot.cpu.load[0] / snapshot.cpu.cores : 0;
  const loadPenalty = Math.min(12, Math.max(0, (loadPressure - 0.7) * 40));
  const alertPenalty = snapshot.alerts.reduce(
    (sum, alert) => sum + (alert.severity === 'critical' ? 8 : alert.severity === 'warning' ? 3 : 1),
    0,
  );

  const score = clampScore(
    100 - (cpuPenalty * 0.3 + memPenalty * 0.3 + diskPenalty * 0.3 + swapPenalty + loadPenalty + alertPenalty),
  );
  return { score, grade: gradeFor(score), label: labelFor(score) };
}

function severityPenalty(status: StatusLevel): number {
  switch (status) {
    case 'critical':
      return 45;
    case 'warning':
      return 18;
    case 'unknown':
      return 6;
    default:
      return 0;
  }
}

function clampScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function gradeFor(score: number): string {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 75) return 'C';
  if (score >= 65) return 'D';
  return 'F';
}

function labelFor(score: number): string {
  if (score >= 90) return 'healthy';
  if (score >= 75) return 'degraded';
  if (score >= 60) return 'under pressure';
  return 'critical';
}

/** Merge partial threshold overrides over the defaults (per key). */
export function mergeThresholds(overrides?: Partial<ThresholdConfig>): ThresholdConfig {
  if (!overrides) return defaultThresholds;
  return {
    cpu: { ...defaultThresholds.cpu, ...overrides.cpu },
    memory: { ...defaultThresholds.memory, ...overrides.memory },
    disk: { ...defaultThresholds.disk, ...overrides.disk },
    latency: { ...defaultThresholds.latency, ...overrides.latency },
    swap: { ...defaultThresholds.swap, ...overrides.swap },
  };
}
