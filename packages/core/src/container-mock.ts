import {
  healthFromPhase,
  type ContainerHealth,
  type ContainerInfo,
  type ContainerPhase,
  type ContainerSnapshot,
  type WorkloadKind,
} from './container-types';

/**
 * Deterministic synthetic fleet generator.
 *
 * Produces a realistic mix of deployments, stateful sets and jobs across a few
 * namespaces, with rolling CPU/memory usage, restart counters, an incident window
 * and crashed pods — enough to exercise every card state and the summary rollups.
 */
export interface MockContainerOptions {
  seed?: number;
  elapsedSeconds?: number;
  /** Fleet size (default 24). */
  size?: number;
  namespaces?: string[];
  nodes?: string[];
  /** Force an incident window (pending/failed pods). */
  incident?: boolean;
}

const DEFAULT_NAMESPACES = ['payments', 'platform', 'data-pipeline', 'edge'];
const DEFAULT_NODES = ['ip-10-24-8-11', 'ip-10-24-8-12', 'ip-10-24-8-13', 'ip-10-24-9-4'];

const WORKLOADS: ReadonlyArray<{ name: string; kind: WorkloadKind; image: string }> = [
  { name: 'api-gateway', kind: 'deployment', image: 'ghcr.io/acme/gateway:2.14.3' },
  { name: 'auth-service', kind: 'deployment', image: 'ghcr.io/acme/auth:1.9.0' },
  { name: 'billing-worker', kind: 'deployment', image: 'ghcr.io/acme/billing:3.2.1' },
  { name: 'postgres', kind: 'statefulset', image: 'postgres:16.3-alpine' },
  { name: 'redis', kind: 'statefulset', image: 'redis:7.4-alpine' },
  { name: 'log-shipper', kind: 'daemonset', image: 'fluent/fluent-bit:3.1' },
  { name: 'nightly-report', kind: 'cronjob', image: 'ghcr.io/acme/report:0.7.9' },
  { name: 'image-scan', kind: 'job', image: 'aquasec/trivy:0.55' },
];

const CRASH_REASONS = ['OOMKilled', 'Error', 'CrashLoopBackOff', 'Evicted'];

/** Small, fast, deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wave = (t: number, period: number, phase = 0): number => (Math.sin(t / period + phase) + 1) / 2;

/** A repeating incident window: pods fail/pend for ~8s every minute. */
function isIncidentWindow(elapsedSeconds: number): boolean {
  const phase = elapsedSeconds % 60;
  return phase >= 44 && phase < 52;
}

/** Short stable hash used to build pod-name suffixes. */
function hash(value: string): string {
  let h = 0;
  for (let index = 0; index < value.length; index += 1) {
    h = (h * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 5);
}

const SUFFIX_ALPHABET = 'bcdfghjklmnpqrstvwxz';
function suffix(ordinal: number): string {
  let value = ordinal + 1;
  let out = '';
  while (out.length < 5) {
    out += SUFFIX_ALPHABET[value % SUFFIX_ALPHABET.length];
    value = Math.floor(value / SUFFIX_ALPHABET.length) + 7;
  }
  return out;
}

/**
 * Builds one batch of synthetic containers.
 *
 * Seeded, so identical inputs produce identical output — tests and screenshots
 * stay reproducible.
 */
export function createMockContainerSnapshot(options: MockContainerOptions = {}): ContainerSnapshot {
  const {
    seed = 11,
    elapsedSeconds = Date.now() / 1000,
    size = 24,
    namespaces = DEFAULT_NAMESPACES,
    nodes = DEFAULT_NODES,
    incident = false,
  } = options;

  const random = mulberry32(seed + Math.floor(elapsedSeconds / 2));
  const incidentActive = incident || isIncidentWindow(elapsedSeconds);
  const containers: ContainerInfo[] = [];

  for (let index = 0; index < size; index += 1) {
    const workload = WORKLOADS[index % WORKLOADS.length]!;
    const namespace = namespaces[index % namespaces.length]!;
    const ordinal = Math.floor(index / WORKLOADS.length);
    const name = `${workload.name}-${hash(`${workload.kind}-${ordinal}`)}-${suffix(ordinal)}`;
    const node = nodes[Math.floor(random() * nodes.length)]!;

    // Incidents hit a deterministic slice of the fleet so the grid shows a mix.
    const hitByIncident = incidentActive && index % 7 === 3;
    const crashed = incidentActive && index % 11 === 5;

    let phase: ContainerPhase = 'running';
    let health: ContainerHealth = 'ok';
    let restarts = 0;
    let lastReason: string | undefined;
    let message: string | undefined;
    let readyContainers = 1;

    if (workload.kind === 'job' || workload.kind === 'cronjob') {
      const done = wave(elapsedSeconds, 90, index) > 0.45;
      phase = done ? 'succeeded' : 'running';
      health = done ? 'unknown' : 'ok';
    }

    if (hitByIncident) {
      phase = 'pending';
      health = 'warning';
      readyContainers = 0;
      message = 'ContainerCreating';
    }

    if (crashed) {
      phase = 'failed';
      health = 'critical';
      readyContainers = 0;
      restarts = 3 + Math.floor(random() * 9);
      lastReason = CRASH_REASONS[Math.floor(random() * CRASH_REASONS.length)]!;
      message = 'Back-off restarting failed container';
    } else if (random() < 0.18) {
      restarts = 1 + Math.floor(random() * 3);
      lastReason = CRASH_REASONS[Math.floor(random() * CRASH_REASONS.length)]!;
      health = restarts >= 3 ? 'critical' : 'warning';
    }

    const cpuLimit = workload.kind === 'statefulset' ? 4 : workload.kind === 'deployment' ? 2 : 1;
    const memoryLimit = workload.kind === 'statefulset' ? 8 * 1024 ** 3 : 1.5 * 1024 ** 3;
    const cpuUsed =
      phase === 'succeeded'
        ? 0
        : Number((cpuLimit * (0.12 + wave(elapsedSeconds, 17 + index * 0.4, index) * 0.55)).toFixed(3));
    const memoryUsed = Math.round(memoryLimit * (0.28 + wave(elapsedSeconds, 41 + index, index * 2) * 0.42));

    const container: ContainerInfo = {
      id: `${namespace}/${name}`,
      name,
      namespace,
      workload: workload.name,
      workloadKind: workload.kind,
      phase,
      health,
      node,
      startedAt: Date.now() - Math.round((3600 + random() * 86400 * 6) * 1000),
      cpu: { used: cpuUsed, limit: cpuLimit, percent: Number(((cpuUsed / cpuLimit) * 100).toFixed(1)) },
      memory: {
        used: memoryUsed,
        limit: memoryLimit,
        percent: Number(((memoryUsed / memoryLimit) * 100).toFixed(1)),
      },
      spec: {
        name: workload.name,
        image: workload.image,
        restarts,
        readyContainers: phase === 'running' ? 1 : readyContainers,
        totalContainers: 1,
      },
      labels: {
        app: workload.name,
        'app.kubernetes.io/managed-by': 'helm',
        tier: namespace === 'data-pipeline' ? 'data' : 'web',
      },
    };

    if (lastReason) container.spec.lastReason = lastReason;
    if (message) container.message = message;
    containers.push(container);
  }

  return {
    timestamp: Date.now(),
    containers,
    mode: 'replace',
    cluster: {
      cpuCapacity: containers.reduce((sum, entry) => sum + (entry.cpu.limit ?? 0), 0),
      memoryCapacity: containers.reduce((sum, entry) => sum + (entry.memory.limit ?? 0), 0),
      nodes: nodes.length,
    },
  };
}

/** Single container, handy for tests and streamed pod events. */
export function createMockContainer(overrides: Partial<ContainerInfo> = {}): ContainerInfo {
  const [first] = createMockContainerSnapshot({ size: 1 }).containers;
  const base: ContainerInfo =
    first ?? {
      id: 'default/pod',
      name: 'pod',
      namespace: 'default',
      phase: 'running',
      health: healthFromPhase('running'),
      cpu: { used: 0.2, limit: 1, percent: 20 },
      memory: { used: 1024 ** 2, limit: 1024 ** 3, percent: 0.1 },
      spec: { name: 'pod', image: 'nginx:alpine', restarts: 0, readyContainers: 1, totalContainers: 1 },
    };
  return { ...base, ...overrides };
}

