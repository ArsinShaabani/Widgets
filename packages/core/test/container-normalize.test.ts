import { describe, expect, it } from 'vitest';
import { ContainerStore, createMockContainerSnapshot, healthFromPhase, toContainerHealth, toContainerPhase } from '@widgets/core';
import { normalizeContainer, normalizeContainerSnapshot } from '../src/container-normalize';

describe('container normalisation', () => {
  it('round-trips a canonical snapshot without losing resources', () => {
    const original = createMockContainerSnapshot({ elapsedSeconds: 100, size: 6 });
    const normalized = normalizeContainerSnapshot(original);
    expect(normalized).not.toBeNull();
    expect(normalized!.containers).toHaveLength(6);

    const first = original.containers[0]!;
    const round = normalized!.containers.find((entry) => entry.name === first.name)!;
    // Regression: canonical `cpu` / `memory` objects used to collapse to zero.
    expect(round.cpu.used).toBeCloseTo(first.cpu.used, 3);
    expect(round.cpu.limit).toBeCloseTo(first.cpu.limit ?? 0, 3);
    expect(round.cpu.percent).toBeCloseTo(first.cpu.percent ?? 0, 1);
    expect(round.memory.used).toBe(first.memory.used);
    expect(round.memory.limit).toBe(first.memory.limit ?? 0);
    expect(round.spec.image).toBe(first.spec.image);
    expect(round.spec.restarts).toBe(first.spec.restarts);
    expect(round.spec.readyContainers).toBe(first.spec.readyContainers);
    expect(round.phase).toBe(first.phase);
    expect(round.health).toBe(first.health);
    expect(round.namespace).toBe(first.namespace);
    expect(round.workload).toBe(first.workload);
    expect(round.node).toBe(first.node);
    expect(round.labels).toMatchObject({ app: first.workload! });
  });

  it('maps a Kubernetes-style pod list', () => {
    const snapshot = normalizeContainerSnapshot({
      items: [
        {
          metadata: { name: 'api-7d9f', namespace: 'payments', labels: { app: 'api' } },
          spec: {
            nodeName: 'ip-10-24-8-11',
            containers: [{ name: 'api', image: 'ghcr.io/acme/api:1.4.0', resources: { limits: { cpu: '2', memory: '2Gi' } } }],
          },
          status: {
            phase: 'Running',
            containerStatuses: [{ restartCount: 3, ready: true, lastTerminationReason: 'OOMKilled' }],
          },
          usage: { cpu: 0.75, memory: 512 ** 3 },
        },
      ],
    });

    expect(snapshot).not.toBeNull();
    const container = snapshot!.containers[0]!;
    expect(container.name).toBe('api-7d9f');
    expect(container.namespace).toBe('payments');
    expect(container.phase).toBe('running');
    expect(container.cpu.used).toBeCloseTo(0.75, 3);
    expect(container.cpu.limit).toBe(2);
    expect(container.cpu.percent).toBeCloseTo(37.5, 1);
    expect(container.memory.used).toBe(512 ** 3);
    expect(container.memory.limit).toBe(2 * 1024 ** 3);
    expect(container.spec.image).toBe('ghcr.io/acme/api:1.4.0');
    expect(container.spec.restarts).toBe(3);
    expect(container.spec.lastReason).toBe('OOMKilled');
    expect(container.node).toBe('ip-10-24-8-11');
    // Restarts turn a running pod into a warning.
    expect(container.health).toBe('warning');
  });

  it('accepts wrapped payloads, arrays and single pods', () => {
    expect(normalizeContainerSnapshot({ data: { pods: [{ name: 'a' }] } })!.containers[0]!.name).toBe('a');
    expect(normalizeContainerSnapshot([{ name: 'b' }, { name: 'c' }])!.containers).toHaveLength(2);
    const single = normalizeContainerSnapshot({ name: 'd', phase: 'Failed', cpuPercent: 10, cpuLimit: 4 });
    expect(single!.mode).toBe('upsert');
    expect(single!.containers[0]!.phase).toBe('failed');
    expect(single!.containers[0]!.cpu.used).toBeCloseTo(0.4, 3);
  });

  it('keeps cluster rollups and honours an explicit upsert mode', () => {
    const snapshot = normalizeContainerSnapshot({
      mode: 'upsert',
      cpuCapacity: 32,
      memoryCapacity: 64 * 1024 ** 3,
      nodes: 4,
      containers: [{ name: 'x' }],
    });
    expect(snapshot!.mode).toBe('upsert');
    expect(snapshot!.cluster).toEqual({ cpuCapacity: 32, memoryCapacity: 64 * 1024 ** 3, nodes: 4 });
  });

  it('rejects payloads without any usable container', () => {
    expect(normalizeContainerSnapshot(null)).toBeNull();
    expect(normalizeContainerSnapshot('nope')).toBeNull();
    expect(normalizeContainerSnapshot([])).toEqual({ timestamp: expect.any(Number), containers: [], mode: 'replace' });
    expect(normalizeContainerSnapshot({ containers: [{ cpu: 1 }] })).toBeNull();
    expect(normalizeContainer(null)).toBeNull();
  });

  it('derives health and normalises phases', () => {
    expect(toContainerPhase('ContainerCreating')).toBe('pending');
    expect(toContainerPhase('CrashLoopBackOff')).toBe('failed');
    expect(toContainerPhase('Succeeded')).toBe('succeeded');
    expect(toContainerPhase('')).toBe('unknown');
    expect(toContainerHealth('Degraded', 'ok')).toBe('warning');
    expect(toContainerHealth('Unhealthy')).toBe('critical');
    expect(toContainerHealth(undefined, 'ok')).toBe('ok');
    expect(healthFromPhase('running')).toBe('ok');
  });

  it('feeds the store so rollups stay accurate', () => {
    const store = new ContainerStore();
    store.update(createMockContainerSnapshot({ elapsedSeconds: 12, size: 12 }));
    const stats = store.stats();
    expect(stats.total).toBe(12);
    expect(stats.cpuUsed).toBeGreaterThan(0);
    expect(stats.cpuLimit).toBeGreaterThan(0);
    expect(stats.memoryUsed).toBeGreaterThan(0);
    expect(stats.byNamespace.length).toBeGreaterThan(1);
  });
});
