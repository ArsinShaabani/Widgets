import {
  healthFromPhase,
  toContainerHealth,
  toContainerPhase,
  type ClusterSummary,
  type ContainerInfo,
  type ContainerSnapshot,
  type ContainerSpec,
  type ResourceUsage,
  type WorkloadKind,
} from './container-types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const num = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' ? String(value) : fallback;

type Rec = Record<string, unknown>;

/**
 * Maps an arbitrary container payload into a `ContainerSnapshot`.
 *
 * Accepted shapes:
 *   - an array of containers
 *   - `{ containers | pods | items | data: [...] }` (Kubernetes `items` included)
 *   - `{ data: { pods: [...] } }` / `{ payload: … }`
 *   - a single container object (streamed pod event)
 *
 * Aliases: `metadata.name`, `status.phase`, `containerStatuses[].restartCount`,
 * `resources.limits`, `usage.cpu` / `cpuPercent`, `mem` / `memoryBytes`, …
 */
export function normalizeContainerSnapshot(payload: unknown): ContainerSnapshot | null {
  const root = unwrap(payload);

  if (Array.isArray(root)) {
    const containers = root.map((entry) => normalizeContainer(entry)).filter(isContainer);
    return containers.length > 0 || root.length === 0
      ? { timestamp: Date.now(), containers, mode: 'replace' }
      : null;
  }

  if (!isRecord(root)) return null;

  const list = firstArray(root, ['containers', 'pods', 'items', 'workloads', 'records']);
  if (list) {
    const containers = list.map((entry) => normalizeContainer(entry)).filter(isContainer);
    if (containers.length === 0 && list.length > 0) return null;
    const cluster = normalizeCluster(root);
    return {
      timestamp: num(root.timestamp ?? root.ts, Date.now()),
      containers,
      mode: root.mode === 'upsert' ? 'upsert' : 'replace',
      ...(cluster ? { cluster } : {}),
    };
  }

  const single = normalizeContainer(root);
  if (!single) return null;
  const cluster = normalizeCluster(root);
  return {
    timestamp: num(root.timestamp ?? root.ts, Date.now()),
    containers: [single],
    mode: 'upsert',
    ...(cluster ? { cluster } : {}),
  };
}

/** Resource dimension, deciding how quantity suffixes are interpreted. */
export type QuantityDimension = 'cpu' | 'memory';

/**
 * Parses Kubernetes resource quantities.
 *
 * CPU accepts cores or a `m`/`u`/`n` suffix (`500m` → `0.5`); memory accepts
 * binary (`Ki`/`Mi`/`Gi`/`Ti`) and decimal (`k`/`M`/`G`) suffixes.
 */
export function parseQuantity(value: unknown, dimension: QuantityDimension): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (text.length === 0) return 0;

  const match = /^([+-]?[0-9]*\.?[0-9]+)([a-zA-Z]*)$/.exec(text);
  if (!match) return 0;
  const amount = Number.parseFloat(match[1]!);
  if (!Number.isFinite(amount)) return 0;
  const suffix = match[2] ?? '';

  if (dimension === 'cpu') {
    if (suffix === 'm') return amount / 1000;
    if (suffix === 'u') return amount / 1e6;
    if (suffix === 'n') return amount / 1e9;
    return amount;
  }

  const binary: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5 };
  const decimal: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
  if (suffix in binary) return amount * binary[suffix]!;
  if (suffix in decimal) return amount * decimal[suffix]!;
  return amount;
}

/** Normalises one container/pod; returns `null` when there is no usable name. */
export function normalizeContainer(raw: unknown): ContainerInfo | null {
  if (!isRecord(raw)) return null;

  const metadata = isRecord(raw.metadata) ? raw.metadata : null;
  const status = isRecord(raw.status) ? raw.status : null;
  const spec = isRecord(raw.spec) ? raw.spec : null;
  const usage = isRecord(raw.usage) ? raw.usage : null;
  const metrics = isRecord(raw.metrics) ? raw.metrics : null;
  const resources = isRecord(raw.resources) ? raw.resources : null;

  const sources = [raw, metadata, status].filter(isRecord) as Rec[];
  const name = str(pick(sources, ['name', 'podName', 'pod', 'containerName']), '');
  if (name.length === 0) return null;

  const namespace = str(pick(sources, ['namespace', 'ns', 'project']), 'default');
  const phase = toContainerPhase(
    pick([status], ['phase', 'podPhase', 'state']) ??
      pick([raw], ['phase', 'state', 'podPhase']) ??
      raw.status,
  );

  const containerStatuses = Array.isArray(status?.containerStatuses) ? (status!.containerStatuses as unknown[]) : [];
  const firstStatus = containerStatuses.filter(isRecord)[0] ?? null;
  const containerSpecs = Array.isArray(spec?.containers) ? (spec!.containers as unknown[]) : [];
  const firstSpec = containerSpecs.filter(isRecord)[0] ?? null;

  const canonicalSpecProbe = isRecord(raw.spec) && !Array.isArray((raw.spec as Rec).containers) ? (raw.spec as Rec) : null;
  const restarts = Math.max(
    num(pick([canonicalSpecProbe, firstStatus, ...sources], ['restartCount', 'restarts', 'restart_count']), 0),
    num(pick([raw, status], ['restarts', 'restartCount']), 0),
  );
  const totalContainers = Math.max(
    1,
    num(
      pick([canonicalSpecProbe, raw], ['totalContainers', 'containerCount', 'containers'], containerSpecs.length || 1),
      containerSpecs.length || 1,
    ),
  );
  const readyContainers = num(
    pick(
      [canonicalSpecProbe, raw, status],
      ['readyContainers', 'ready', 'availableReplicas'],
      readyFromStatus(firstStatus) ?? totalContainers,
    ),
    totalContainers,
  );

  const limitSource = isRecord(firstSpec?.resources)
    ? ((firstSpec!.resources as Rec).limits as Rec | undefined)
    : undefined;
  const limits = isRecord(limitSource) ? limitSource : isRecord(resources?.limits) ? (resources!.limits as Rec) : null;

  // Canonical containers carry `cpu` / `memory` as `{ used, limit, percent }` and a
  // ready-made `spec`; Kubernetes-style payloads carry scalars and `spec.containers`.
  const canonicalCpu = resourceFrom(raw.cpu);
  const canonicalMemory = resourceFrom(raw.memory);
  const canonicalSpec =
    isRecord(raw.spec) && !Array.isArray((raw.spec as Rec).containers) ? (raw.spec as Rec) : null;

  // Percent-only backends report `cpuPercent` / `memoryPercent`; absolute backends
  // report cores / bytes. The key decides, not the value format.
  const cpuPercentRaw = pick([usage, metrics, raw, ...sources], ['cpuPercent', 'cpu_percent'], null);
  const memPercentRaw = pick([usage, metrics, raw, ...sources], ['memoryPercent', 'memPercent', 'mem_percent'], null);
  const cpuRaw = pick([usage, metrics, raw, ...sources], ['cpu', 'cpuUsage', 'cpu_usage', 'cpu_cores'], 0);
  const memRaw = pick(
    [usage, metrics, raw, ...sources],
    ['memory', 'mem', 'memoryBytes', 'memBytes', 'memory_usage', 'rss'],
    0,
  );
  const cpuLimit = pick([limits, raw], ['cpu', 'cpuLimit', 'cpu_limit'], 0);
  const memoryLimit = pick([limits, raw], ['memory', 'memoryLimit', 'memory_limit'], 0);

  const cpu =
    canonicalCpu ??
    (cpuPercentRaw != null
      ? buildUsageFromPercent(num(cpuPercentRaw), cpuLimit, 'cpu')
      : buildUsage(cpuRaw, cpuLimit, looksLikePercent(cpuRaw), 'cpu'));
  const memory =
    canonicalMemory ??
    (memPercentRaw != null
      ? buildUsageFromPercent(num(memPercentRaw), memoryLimit, 'memory')
      : buildUsage(memRaw, memoryLimit, looksLikePercent(memRaw), 'memory'));

  const containerSpec: ContainerSpec = {
    name: str(pick([canonicalSpec, firstSpec, raw], ['name', 'containerName'], name), name),
    image: str(pick([canonicalSpec, firstSpec, raw], ['image', 'imageName'], 'n/a'), 'n/a'),
    restarts,
    readyContainers: Math.min(readyContainers, totalContainers),
    totalContainers,
  };
  const reason = str(
    pick([canonicalSpec, firstStatus, status, raw], ['lastReason', 'lastTerminationReason', 'reason'], ''),
    '',
  );
  if (reason.length > 0) containerSpec.lastReason = reason;

  const startedAt = startTime(pick([status, raw], ['startTime', 'startedAt', 'createdAt', 'created', 'since']));
  const workload = str(pick([metadata, raw], ['workload', 'owner', 'deployment', 'statefulSet', 'app'], ''), '');
  const labels = normalizeLabels(metadata?.labels ?? raw.labels);
  const health = toContainerHealth(
    pick([raw, status], ['health', 'healthStatus', 'condition']),
    deriveHealth(phase, restarts, readyContainers, totalContainers),
  );

  const container: ContainerInfo = {
    id: str(pick([raw], ['id', 'uid', 'podUid'], `${namespace}/${name}`), `${namespace}/${name}`),
    name,
    namespace,
    phase,
    health,
    cpu,
    memory,
    spec: containerSpec,
  };

  if (workload.length > 0) container.workload = workload;
  const workloadKind = pick([metadata, raw], ['workloadKind', 'kind', 'ownerKind'], undefined);
  if (workloadKind !== undefined) container.workloadKind = toWorkloadKind(workloadKind);
  const node = str(pick([spec, raw, status], ['node', 'nodeName', 'hostNode'], ''), '');
  if (node.length > 0) container.node = node;
  if (startedAt !== undefined) container.startedAt = startedAt;
  if (labels) container.labels = labels;
  const message = str(pick([raw, status], ['message', 'statusMessage'], ''), '');
  if (message.length > 0 && message !== containerSpec.lastReason) container.message = message;

  return container;
}


function resourceFrom(value: unknown): ResourceUsage | null {
  if (!isRecord(value)) return null;
  const used = num(value.used, Number.NaN);
  if (!Number.isFinite(used)) return null;
  const limit = Math.max(0, num(value.limit, 0));
  const percent = num(value.percent, limit > 0 ? (used / limit) * 100 : 0);
  return {
    used: Number(Math.max(0, used).toFixed(4)),
    limit,
    percent: Number(percent.toFixed(1)),
  };
}

/** Converts a percentage reading into an absolute amount when the limit is known. */
function buildUsageFromPercent(percent: number, limitRaw: unknown, dimension: QuantityDimension): ResourceUsage {
  const limit = Math.max(0, parseQuantity(limitRaw, dimension));
  const pct = Math.min(100, Math.max(0, percent));
  const used = limit > 0 ? (limit * pct) / 100 : pct;
  return { used: Number(used.toFixed(4)), limit, percent: Number(pct.toFixed(1)) };
}

function buildUsage(
  raw: unknown,
  limitRaw: unknown,
  rawIsPercent: boolean,
  dimension: QuantityDimension,
): ResourceUsage {
  const limit = Math.max(0, parseQuantity(limitRaw, dimension));
  let used = typeof raw === 'string' ? parseQuantity(raw, dimension) : num(raw, 0);

  if (rawIsPercent && limit > 0) used = (limit * Math.min(100, Math.max(0, used))) / 100;
  else if (rawIsPercent && limit === 0) used = used; // percentage only: keep as reported

  const usage: ResourceUsage = { used: Number(used.toFixed(4)), limit };
  if (limit > 0) usage.percent = Number(((used / limit) * 100).toFixed(1));
  return usage;
}

/** True when a numeric value looks like a percentage rather than an absolute amount. */
function looksLikePercent(value: unknown): boolean {
  if (typeof value !== 'number') return typeof value === 'string' && value.trim().endsWith('%');
  return false;
}

/** `containerStatuses[].ready` → number of ready containers. */
function readyFromStatus(status: Rec | null): number | null {
  if (!status) return null;
  if (status.ready === true) return 1;
  if (status.ready === false) return 0;
  return null;
}

/** Derives health when the backend does not report one. */
function deriveHealth(
  phase: ContainerInfo['phase'],
  restarts: number,
  readyContainers: number,
  totalContainers: number,
): ContainerInfo['health'] {
  if (phase === 'failed') return 'critical';
  if (readyContainers < totalContainers) return 'warning';
  if (restarts >= 5) return 'critical';
  if (restarts > 0 || phase === 'pending') return 'warning';
  return healthFromPhase(phase);
}

/** Parses ISO strings, epoch seconds/milliseconds and `Date` into epoch ms. */
function startTime(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1e11) return Math.round(value * 1000);
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') return startTime(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function normalizeLabels(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const labels: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      labels[key] = String(raw);
    }
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

function toWorkloadKind(value: unknown): WorkloadKind {
  const text = String(value ?? '').toLowerCase();
  if (text.startsWith('state')) return 'statefulset';
  if (text.startsWith('daemon')) return 'daemonset';
  if (text.startsWith('cron')) return 'cronjob';
  if (text.startsWith('job')) return 'job';
  if (text.startsWith('deploy')) return 'deployment';
  return 'standalone';
}

function normalizeCluster(root: Rec): ClusterSummary | null {
  const cluster = isRecord(root.cluster) ? root.cluster : null;
  const source = cluster ?? root;
  const cpuCapacity = num(pick([source], ['cpuCapacity', 'cpu_capacity', 'cpuTotal'], 0), 0);
  const memoryCapacity = num(pick([source], ['memoryCapacity', 'memory_capacity', 'memoryTotal'], 0), 0);
  const nodes = num(pick([source], ['nodes', 'nodeCount', 'node_count'], 0), 0);
  if (cpuCapacity === 0 && memoryCapacity === 0 && nodes === 0) return null;
  return {
    ...(cpuCapacity > 0 ? { cpuCapacity } : {}),
    ...(memoryCapacity > 0 ? { memoryCapacity } : {}),
    ...(nodes > 0 ? { nodes } : {}),
  };
}

function unwrap(payload: unknown): unknown {
  let current = payload;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current)) return current;
    const inner = current.data ?? current.payload ?? current.result;
    if (inner === undefined) return current;
    current = inner;
  }
  return current;
}

function firstArray(root: Rec, keys: readonly string[]): unknown[] | null {
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

/** First defined value across the sources, falling back to `fallback` (default `undefined`). */
function pick(raw: Array<Rec | null>, keys: readonly string[], fallback?: unknown): unknown {
  for (const source of raw) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return fallback;
}

function isContainer(value: ContainerInfo | null): value is ContainerInfo {
  return value !== null;
}

