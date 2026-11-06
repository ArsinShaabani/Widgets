import type { SnapshotSink } from './connector';
import { Emitter } from './emitter';
import {
  HEALTH_RANK,
  type ContainerFilter,
  type ContainerHealth,
  type ContainerInfo,
  type ContainerPhase,
  type ContainerSnapshot,
  type ContainerStats,
} from './container-types';

export interface ContainerStoreEvents {
  update: { changed: ContainerInfo[]; removed: string[]; total: number };
  /** A container changed health bucket (hosts use this for notifications). */
  transition: { container: ContainerInfo; from: ContainerHealth; to: ContainerHealth };
  reset: { total: number };
  stats: ContainerStats;
}

export interface ContainerStoreOptions {
  /** Maximum tracked containers (default 500). */
  maxContainers?: number;
  /** Sparkline samples kept per container (default 24). */
  historySize?: number;
  /** Clock injection point for tests. */
  now?: () => number;
  /** Upsert mode: drop containers not seen for this long (0 = keep forever). */
  ttlMs?: number;
}

const emptyPhases = (): Record<ContainerPhase, number> => ({
  running: 0,
  pending: 0,
  succeeded: 0,
  failed: 0,
  unknown: 0,
});

const emptyHealth = (): Record<ContainerHealth, number> => ({
  ok: 0,
  warning: 0,
  critical: 0,
  unknown: 0,
});

/**
 * Live container fleet state.
 *
 * Framework free: keeps the latest state per container, a bounded CPU history for
 * card sparklines, rollups for the summary row, and emits health transitions.
 */
export class ContainerStore implements SnapshotSink<ContainerSnapshot> {
  private readonly events = new Emitter<ContainerStoreEvents>();
  private readonly maxContainers: number;
  private readonly historySize: number;
  private readonly now: () => number;
  private readonly ttlMs: number;

  private containers = new Map<string, ContainerInfo>();
  private histories = new Map<string, number[]>();
  private lastSeen = new Map<string, number>();
  private lastHealth = new Map<string, ContainerHealth>();
  private cluster: ContainerSnapshot['cluster'];
  private received = 0;
  private versionValue = 0;
  private filterCache: { signature: string; version: number; result: ContainerInfo[] } = {
    signature: '',
    version: -1,
    result: [],
  };

  constructor(options: ContainerStoreOptions = {}) {
    this.maxContainers = Math.max(10, options.maxContainers ?? 500);
    this.historySize = Math.max(4, options.historySize ?? 24);
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = Math.max(0, options.ttlMs ?? 0);
  }

  get on(): Emitter<ContainerStoreEvents>['on'] {
    return this.events.on.bind(this.events);
  }

  get off(): Emitter<ContainerStoreEvents>['off'] {
    return this.events.off.bind(this.events);
  }

  get version(): number {
    return this.versionValue;
  }

  get size(): number {
    return this.containers.size;
  }

  get clusterSummary(): ContainerSnapshot['cluster'] {
    return this.cluster;
  }

  /** Implements `SnapshotSink<ContainerSnapshot>`. */
  update(snapshot: ContainerSnapshot): void {
    const seenAt = this.now();
    const changed: ContainerInfo[] = [];
    const removed: string[] = [];

    if (snapshot.mode === 'replace') {
      for (const id of this.containers.keys()) {
        if (!snapshot.containers.some((container) => container.id === id)) removed.push(id);
      }
      for (const id of removed) this.forget(id);
    }

    for (const container of snapshot.containers) {
      const enriched = this.withHistory(container);
      const previous = this.lastHealth.get(container.id);
      this.containers.set(container.id, enriched);
      this.lastSeen.set(container.id, seenAt);
      this.received += 1;
      changed.push(enriched);
      if (previous && previous !== enriched.health) {
        this.events.emit('transition', { container: enriched, from: previous, to: enriched.health });
      }
      this.lastHealth.set(container.id, enriched.health);
    }

    if (snapshot.cluster) this.cluster = snapshot.cluster;
    this.evictStale(seenAt);
    this.trim();

    this.versionValue += 1;
    this.events.emit('update', { changed, removed, total: this.containers.size });
    this.events.emit('stats', this.stats());
  }

  /** Latest state for every tracked container, most severe first. */
  all(): ContainerInfo[] {
    return [...this.containers.values()].sort((a, b) => {
      const rank = HEALTH_RANK[b.health] - HEALTH_RANK[a.health];
      if (rank !== 0) return rank;
      return a.namespace === b.namespace ? a.name.localeCompare(b.name) : a.namespace.localeCompare(b.namespace);
    });
  }

  get(id: string): ContainerInfo | undefined {
    return this.containers.get(id);
  }

  /** Applies a filter (cached until the filter or the fleet changes). */
  filtered(filter: ContainerFilter, limit?: number): ContainerInfo[] {
    const signature = `${filter.phases.join(',')}|${filter.namespaces.join(',')}|${filter.query}|${filter.attentionOnly ?? false}|${limit ?? 0}`;
    if (this.filterCache.version === this.versionValue && this.filterCache.signature === signature) {
      return this.filterCache.result;
    }

    const phases = new Set(filter.phases);
    const namespaces = new Set(filter.namespaces);
    const query = filter.query.trim().toLowerCase();

    const matched = this.all().filter((container) => {
      if (phases.size > 0 && !phases.has(container.phase)) return false;
      if (namespaces.size > 0 && !namespaces.has(container.namespace)) return false;
      if (filter.attentionOnly && container.health !== 'warning' && container.health !== 'critical') return false;
      if (query.length === 0) return true;
      if (container.name.toLowerCase().includes(query)) return true;
      if (container.namespace.toLowerCase().includes(query)) return true;
      if (container.workload?.toLowerCase().includes(query)) return true;
      if (container.node?.toLowerCase().includes(query)) return true;
      if (container.spec.image.toLowerCase().includes(query)) return true;
      if (container.spec.lastReason?.toLowerCase().includes(query)) return true;
      if (container.labels) {
        for (const [key, value] of Object.entries(container.labels)) {
          if (key.toLowerCase().includes(query) || value.toLowerCase().includes(query)) return true;
        }
      }
      return false;
    });

    const result = limit != null && matched.length > limit ? matched.slice(0, limit) : matched;
    this.filterCache = { signature, version: this.versionValue, result };
    return result;
  }

  /** Namespaces present in the fleet, most populated first. */
  namespaces(): string[] {
    return this.stats().byNamespace.map((entry) => entry.namespace);
  }

  /** CPU sparkline history for a container (oldest first). */
  history(id: string): number[] {
    return [...(this.histories.get(id) ?? [])];
  }


  /** Rollups for the summary row and capacity sections. */
  stats(): ContainerStats {
    const byPhase = emptyPhases();
    const byHealth = emptyHealth();
    const namespaces = new Map<string, { namespace: string; count: number; critical: number }>();
    let restarts = 0;
    let notReady = 0;
    let cpuUsed = 0;
    let cpuLimit = 0;
    let memoryUsed = 0;
    let memoryLimit = 0;

    for (const container of this.containers.values()) {
      byPhase[container.phase] += 1;
      byHealth[container.health] += 1;
      restarts += container.spec.restarts;
      if (container.spec.readyContainers < container.spec.totalContainers) notReady += 1;
      cpuUsed += container.cpu.used;
      cpuLimit += container.cpu.limit ?? 0;
      memoryUsed += container.memory.used;
      memoryLimit += container.memory.limit ?? 0;

      const stat = namespaces.get(container.namespace) ?? { namespace: container.namespace, count: 0, critical: 0 };
      stat.count += 1;
      if (container.health === 'critical') stat.critical += 1;
      namespaces.set(container.namespace, stat);
    }

    return {
      total: this.containers.size,
      byPhase,
      byHealth,
      byNamespace: [...namespaces.values()].sort((a, b) => b.count - a.count),
      restarts,
      notReady,
      cpuUsed: Number(cpuUsed.toFixed(3)),
      cpuLimit: Number(cpuLimit.toFixed(3)),
      memoryUsed,
      memoryLimit,
    };
  }

  clear(): void {
    this.containers.clear();
    this.histories.clear();
    this.lastSeen.clear();
    this.lastHealth.clear();
    this.cluster = undefined;
    this.received = 0;
    this.versionValue += 1;
    this.events.emit('reset', { total: 0 });
    this.events.emit('stats', this.stats());
  }

  dispose(): void {
    this.events.clear();
    this.clear();
  }

  /** Attaches the rolling CPU sample used by the card sparkline. */
  private withHistory(container: ContainerInfo): ContainerInfo {
    const history = this.histories.get(container.id) ?? [];
    history.push(container.cpu.used);
    if (history.length > this.historySize) history.splice(0, history.length - this.historySize);
    this.histories.set(container.id, history);
    return { ...container, cpuHistory: [...history] };
  }

  private forget(id: string): void {
    this.containers.delete(id);
    this.histories.delete(id);
    this.lastSeen.delete(id);
    this.lastHealth.delete(id);
  }

  private evictStale(now: number): void {
    if (this.ttlMs <= 0) return;
    for (const [id, seenAt] of this.lastSeen) {
      if (now - seenAt > this.ttlMs) this.forget(id);
    }
  }

  /** Caps the fleet size, dropping the healthiest containers first. */
  private trim(): void {
    if (this.containers.size <= this.maxContainers) return;
    const ordered = [...this.containers.values()].sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health]);
    const excess = this.containers.size - this.maxContainers;
    for (let index = 0; index < excess; index += 1) {
      const victim = ordered[index];
      if (victim) this.forget(victim.id);
    }
  }
}

