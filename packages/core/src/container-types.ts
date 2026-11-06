/**
 * Container / workload contracts for the container-grid widget.
 *
 * Kept in `core` so hosts, the mock server and every renderer agree on the shape.
 */

/** Kubernetes-style lifecycle phase, normalised. */
export type ContainerPhase = 'running' | 'pending' | 'succeeded' | 'failed' | 'unknown';

/** Derived health used for colours and sorting. */
export type ContainerHealth = 'ok' | 'warning' | 'critical' | 'unknown';

/** How a pod was scheduled / what owns it. */
export type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset' | 'job' | 'cronjob' | 'standalone';

export interface ResourceUsage {
  /** Current usage in the metric's natural unit (cores for CPU, bytes for memory). */
  used: number;
  /** Requested / limit, when known. `0` means "not reported". */
  limit?: number;
  /** Usage as a percentage of the limit, when a limit is known. */
  percent?: number;
}

export interface ContainerSpec {
  name: string;
  /** Image with tag, as scheduled. */
  image: string;
  /** Container restart count (the max across containers). */
  restarts: number;
  /** Ready containers / total containers. */
  readyContainers: number;
  totalContainers: number;
  /** Last termination reason, when the pod restarted (e.g. `OOMKilled`). */
  lastReason?: string;
}

export interface ContainerInfo {
  /** Stable id (`namespace/name` by default). */
  id: string;
  name: string;
  namespace: string;
  /** Owning workload name, when the backend reports one. */
  workload?: string;
  workloadKind?: WorkloadKind;
  phase: ContainerPhase;
  health: ContainerHealth;
  node?: string;
  /** Epoch ms the pod started (used for the age label). */
  startedAt?: number;
  cpu: ResourceUsage;
  memory: ResourceUsage;
  spec: ContainerSpec;
  /** Small CPU history kept by the store for the card sparkline. */
  cpuHistory?: number[];
  /** Arbitrary labels surfaced in the detail panel. */
  labels?: Record<string, string>;
  /** Human readable reason for the current phase (e.g. `CrashLoopBackOff`). */
  message?: string;
}

/** One batch of container state (full replace or an incremental upsert). */
export interface ContainerSnapshot {
  timestamp: number;
  containers: ContainerInfo[];
  /** `'replace'` treats the batch as the whole fleet, `'upsert'` merges. */
  mode?: 'upsert' | 'replace';
  /** Cluster level rollup, when the backend reports one. */
  cluster?: ClusterSummary;
}

export interface ClusterSummary {
  /** Sum of CPU limits across the fleet, in cores. */
  cpuCapacity?: number;
  /** Sum of memory limits, in bytes. */
  memoryCapacity?: number;
  /** Total nodes reporting in, when known. */
  nodes?: number;
}

export interface ContainerFilter {
  /** Phases to keep; empty means "all". */
  phases: ContainerPhase[];
  /** Namespaces to keep; empty means "all". */
  namespaces: string[];
  /** Free-text query against name, namespace, workload, node and image. */
  query: string;
  /** Only pods with restarts / not ready / unhealthy. */
  attentionOnly?: boolean;
}

export const emptyContainerFilter: ContainerFilter = { phases: [], namespaces: [], query: '' };

export interface ContainerStats {
  total: number;
  byPhase: Record<ContainerPhase, number>;
  byHealth: Record<ContainerHealth, number>;
  byNamespace: Array<{ namespace: string; count: number; critical: number }>;
  restarts: number;
  /** Containers that are not ready relative to their declared replicas. */
  notReady: number;
  cpuUsed: number;
  cpuLimit: number;
  memoryUsed: number;
  memoryLimit: number;
}

/** Severity ordering helper (higher = worse). */
export const HEALTH_RANK: Record<ContainerHealth, number> = {
  unknown: -1,
  ok: 0,
  warning: 1,
  critical: 2,
};

/** Maps a phase onto a health bucket, used when the backend reports no health. */
export function healthFromPhase(phase: ContainerPhase): ContainerHealth {
  switch (phase) {
    case 'running':
      return 'ok';
    case 'pending':
      return 'warning';
    case 'failed':
      return 'critical';
    case 'succeeded':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Normalises free-form phase strings (`Running`, `CrashLoopBackOff`, `Succeeded`…). */
export function toContainerPhase(value: unknown): ContainerPhase {
  // Guard against structured payloads (`status: {...}`) being coerced to a phase.
  if (typeof value !== 'string' && typeof value !== 'number') return 'unknown';
  const text = String(value).trim().toLowerCase();
  if (text.startsWith('run')) return 'running';
  if (text.startsWith('pend') || text.startsWith('creat') || text.startsWith('init') || text.startsWith('containercreating')) {
    return 'pending';
  }
  if (text.startsWith('succe') || text.startsWith('complete')) return 'succeeded';
  if (text.startsWith('fail') || text.startsWith('error') || text.startsWith('crash') || text.startsWith('evict')) {
    return 'failed';
  }
  if (text.startsWith('unknown') || text.length === 0) return 'unknown';
  return 'pending';
}

/** Normalises health strings (`Healthy`, `Degraded`, `Warning`, `Ready`…). */
export function toContainerHealth(value: unknown, fallback: ContainerHealth = 'unknown'): ContainerHealth {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const text = String(value).trim().toLowerCase();
  if (text.length === 0) return fallback;
  if (text.startsWith('crit') || text.startsWith('unhealthy') || text.startsWith('fail') || text.startsWith('error')) {
    return 'critical';
  }
  if (text.startsWith('warn') || text.startsWith('degrad') || text.startsWith('pending')) return 'warning';
  if (text.startsWith('ok') || text.startsWith('healthy') || text.startsWith('ready') || text.startsWith('good')) {
    return 'ok';
  }
  return fallback;
}
