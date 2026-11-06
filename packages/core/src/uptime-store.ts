import type { SnapshotSink } from './connector';
import { Emitter } from './emitter';
import {
  STATE_RANK,
  worstState,
  type ServiceState,
  type UptimeFilter,
  type UptimeIncident,
  type UptimeService,
  type UptimeSnapshot,
  type UptimeStats,
} from './uptime-types';

export interface UptimeStoreEvents {
  update: { services: UptimeService[]; incidents: UptimeIncident[]; total: number };
  /** A service changed state (hosts use this for notifications). */
  transition: { service: UptimeService; from: ServiceState; to: ServiceState };
  /** An incident opened, changed or resolved. */
  incident: { incident: UptimeIncident; change: 'opened' | 'resolved' | 'updated' };
  reset: { total: number };
  stats: UptimeStats;
}

export interface UptimeStoreOptions {
  /** Maximum incidents kept (default 200). */
  maxIncidents?: number;
  /** History window kept per service in days (default 90). */
  windowDays?: number;
  now?: () => number;
}

const emptyStates = (): Record<ServiceState, number> => ({
  operational: 0,
  degraded: 0,
  partial_outage: 0,
  major_outage: 0,
  maintenance: 0,
  unknown: 0,
});

/**
 * Uptime / SLA state.
 *
 * Keeps the latest service health, the daily history painted by the heatmap, the
 * incident log, and derives the rollups (overall availability, MTTR/MTBF, error
 * budgets) that the widget's summary sections render.
 */
export class UptimeStore implements SnapshotSink<UptimeSnapshot> {
  private readonly events = new Emitter<UptimeStoreEvents>();
  private readonly maxIncidents: number;
  private readonly windowDays: number;
  private readonly now: () => number;

  private services = new Map<string, UptimeService>();
  private incidents = new Map<string, UptimeIncident>();
  private lastState = new Map<string, ServiceState>();
  private lastIncidentState = new Map<string, UptimeIncident['state']>();
  private versionValue = 0;
  private filterCache: { signature: string; version: number; result: UptimeService[] } = {
    signature: '',
    version: -1,
    result: [],
  };

  constructor(options: UptimeStoreOptions = {}) {
    this.maxIncidents = Math.max(10, options.maxIncidents ?? 200);
    this.windowDays = Math.max(7, options.windowDays ?? 90);
    this.now = options.now ?? (() => Date.now());
  }

  get on(): Emitter<UptimeStoreEvents>['on'] {
    return this.events.on.bind(this.events);
  }

  get off(): Emitter<UptimeStoreEvents>['off'] {
    return this.events.off.bind(this.events);
  }

  get version(): number {
    return this.versionValue;
  }

  get size(): number {
    return this.services.size;
  }

  get incidentCount(): number {
    return this.incidents.size;
  }

  /** Implements `SnapshotSink<UptimeSnapshot>`. */
  update(snapshot: UptimeSnapshot): void {
    if (snapshot.mode === 'replace') {
      const incoming = new Set(snapshot.services.map((service) => service.id));
      for (const id of [...this.services.keys()]) {
        if (!incoming.has(id)) {
          this.services.delete(id);
          this.lastState.delete(id);
        }
      }
    }

    for (const service of snapshot.services) {
      const trimmed = this.trimHistory(service);
      const previous = this.lastState.get(service.id);
      this.services.set(service.id, trimmed);
      this.lastState.set(service.id, trimmed.state);
      if (previous && previous !== trimmed.state) {
        this.events.emit('transition', { service: trimmed, from: previous, to: trimmed.state });
      }
    }

    for (const incident of snapshot.incidents) {
      const previous = this.lastIncidentState.get(incident.id);
      this.incidents.set(incident.id, incident);
      this.lastIncidentState.set(incident.id, incident.state);
      if (previous === undefined) {
        this.events.emit('incident', { incident, change: 'opened' });
      } else if (previous !== incident.state) {
        this.events.emit('incident', {
          incident,
          change: incident.state === 'resolved' ? 'resolved' : 'updated',
        });
      }
    }

    this.trimIncidents();
    this.versionValue += 1;
    this.events.emit('update', {
      services: snapshot.services,
      incidents: snapshot.incidents,
      total: this.services.size,
    });
    this.events.emit('stats', this.stats());
  }

  /** Services sorted by severity, then by availability (worst first). */
  all(): UptimeService[] {
    return [...this.services.values()].sort((a, b) => {
      const rank = STATE_RANK[b.state] - STATE_RANK[a.state];
      if (rank !== 0) return rank;
      if (a.uptime !== b.uptime) return a.uptime - b.uptime;
      return a.name.localeCompare(b.name);
    });
  }

  get(id: string): UptimeService | undefined {
    return this.services.get(id);
  }

  /** Incidents sorted newest first. */
  allIncidents(): UptimeIncident[] {
    return [...this.incidents.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  getIncident(id: string): UptimeIncident | undefined {
    return this.incidents.get(id);
  }

  /** Incidents overlapping a given day (used by the heatmap tooltip). */
  incidentsForDay(day: number): UptimeIncident[] {
    const end = day + 86_400_000;
    return this.allIncidents().filter((incident) => {
      const incidentEnd = incident.resolvedAt ?? this.now();
      return incident.startedAt < end && incidentEnd >= day;
    });
  }

  /** Services referenced by an incident, resolved through the service index. */
  servicesForIncident(incident: UptimeIncident): UptimeService[] {
    return incident.services
      .map((id) => this.services.get(id))
      .filter((service): service is UptimeService => Boolean(service));
  }

  /** Distinct groups present in the fleet, largest first. */
  groups(): string[] {
    return this.stats().byGroup.map((entry) => entry.group);
  }


  /** Applies a filter (cached until the filter or the fleet changes). */
  filtered(filter: UptimeFilter): UptimeService[] {
    const signature = `${filter.states.join(',')}|${filter.groups.join(',')}|${filter.query}|${filter.attentionOnly ?? false}`;
    if (this.filterCache.version === this.versionValue && this.filterCache.signature === signature) {
      return this.filterCache.result;
    }

    const states = new Set(filter.states);
    const groups = new Set(filter.groups);
    const query = filter.query.trim().toLowerCase();

    const matched = this.all().filter((service) => {
      if (states.size > 0 && !states.has(service.state)) return false;
      if (groups.size > 0 && !groups.has(service.group ?? '')) return false;
      if (filter.attentionOnly) {
        const breached = service.uptime < service.sloTarget;
        const impacted = Boolean(service.activeIncidentId) || STATE_RANK[service.state] >= STATE_RANK.degraded;
        if (!breached && !impacted) return false;
      }
      if (query.length === 0) return true;
      if (service.name.toLowerCase().includes(query)) return true;
      if ((service.group ?? '').toLowerCase().includes(query)) return true;
      if (service.activeIncidentId?.toLowerCase().includes(query)) return true;
      return this.allIncidents().some(
        (incident) =>
          incident.services.includes(service.id) && incident.title.toLowerCase().includes(query),
      );
    });

    this.filterCache = { signature, version: this.versionValue, result: matched };
    return matched;
  }

  /** Rollups for the summary sections. */
  stats(): UptimeStats {
    const byState = emptyStates();
    const groups = new Map<string, { group: string; count: number; impacted: number }>();
    let impacted = 0;
    let belowSlo = 0;
    let uptimeSum = 0;
    let weightedDays = 0;
    let worst: ServiceState = 'unknown';
    let windowDays = 0;

    for (const service of this.services.values()) {
      byState[service.state] += 1;
      const isImpacted = Boolean(service.activeIncidentId) || STATE_RANK[service.state] >= STATE_RANK.degraded;
      if (isImpacted) impacted += 1;
      if (service.uptime < service.sloTarget) belowSlo += 1;

      const days = service.days.length;
      uptimeSum += service.uptime * days;
      weightedDays += days;
      windowDays = Math.max(windowDays, days);

      worst = worstState(worst, service.state);

      const groupName = service.group ?? 'ungrouped';
      const stat = groups.get(groupName) ?? { group: groupName, count: 0, impacted: 0 };
      stat.count += 1;
      if (isImpacted) stat.impacted += 1;
      groups.set(groupName, stat);
    }

    const incidents = this.allIncidents();
    const openIncidents = incidents.filter((incident) => incident.state !== 'resolved').length;
    const resolved = incidents.filter((incident) => incident.resolvedAt != null);
    const mttr =
      resolved.length > 0
        ? resolved.reduce((sum, incident) => sum + Math.max(0, (incident.resolvedAt ?? 0) - incident.startedAt), 0) /
          resolved.length
        : 0;
    const sorted = [...incidents].sort((a, b) => a.startedAt - b.startedAt);
    let gaps = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      gaps += sorted[index]!.startedAt - sorted[index - 1]!.startedAt;
    }
    const mtbf = sorted.length > 1 ? gaps / (sorted.length - 1) : 0;

    return {
      total: this.services.size,
      byState,
      byGroup: [...groups.values()].sort((a, b) => b.count - a.count),
      impacted,
      belowSlo,
      overallUptime: weightedDays > 0 ? Number((uptimeSum / weightedDays).toFixed(4)) : 100,
      worstState: worst,
      openIncidents,
      resolvedIncidents: resolved.length,
      mttr,
      mtbf,
      windowDays: windowDays || this.windowDays,
    };
  }

  clear(): void {
    this.services.clear();
    this.incidents.clear();
    this.lastState.clear();
    this.lastIncidentState.clear();
    this.versionValue += 1;
    this.events.emit('reset', { total: 0 });
    this.events.emit('stats', this.stats());
  }

  dispose(): void {
    this.events.clear();
    this.clear();
  }

  /** Keeps only the configured window of days per service. */
  private trimHistory(service: UptimeService): UptimeService {
    if (service.days.length <= this.windowDays) return service;
    return { ...service, days: service.days.slice(service.days.length - this.windowDays) };
  }

  /** Keeps the newest incidents up to the cap. */
  private trimIncidents(): void {
    if (this.incidents.size <= this.maxIncidents) return;
    const ordered = this.allIncidents();
    for (let index = this.maxIncidents; index < ordered.length; index += 1) {
      const victim = ordered[index];
      if (victim) {
        this.incidents.delete(victim.id);
        this.lastIncidentState.delete(victim.id);
      }
    }
  }
}

