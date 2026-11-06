/**
 * Synthetic server-metrics source.
 *
 * Exposes the exact same snapshot through three transports so every widget code
 * path can be exercised locally:
 *
 *   GET  /api/v1/server/metrics           canonical snapshot (JSON)
 *   GET  /api/v1/server/metrics?shape=flat flat/snake_case payload (alias mapping)
 *   GET  /api/v1/server/events            Server-Sent Events stream
 *   WS   /stream                          WebSocket stream (subscribe protocol)
 *   GET  /health                          liveness probe
 *
 * The generator lives in `@widgets/core` (`createMockSnapshot`) so the browser
 * demo, the unit tests and this server all agree on the data shape.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createMockContainerSnapshot,
  createMockLogSnapshot,
  createMockSnapshot,
  createMockUptimeSnapshot,
  type ContainerSnapshot,
  type LogSnapshot,
  type UptimeSnapshot,
  type WidgetSnapshot,
} from '@widgets/core';
import { WebSocketServer, type WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 4310);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 1000);
const LOG_INTERVAL_MS = Number(process.env.LOG_INTERVAL_MS ?? 1200);
const CONTAINER_INTERVAL_MS = Number(process.env.CONTAINER_INTERVAL_MS ?? 3000);
const UPTIME_INTERVAL_MS = Number(process.env.UPTIME_INTERVAL_MS ?? 5000);
const HOSTNAME = process.env.HOSTNAME_LABEL ?? 'prod-edge-01';
const CPU_BASELINE = Number(process.env.CPU_BASELINE ?? 52);

let tick = 0;
let logTick = 0;
let containerTick = 0;
let uptimeTick = 0;

/** Full canonical snapshot, refreshed on the server clock. */
function snapshot(): WidgetSnapshot {
  tick += 1;
  return createMockSnapshot({
    seed: 21,
    hostname: HOSTNAME,
    cores: 16,
    cpuBaseline: CPU_BASELINE,
    elapsedSeconds: tick * (INTERVAL_MS / 1000),
  });
}

/** A batch of synthetic log lines. */
function logBatch(count = 5): LogSnapshot {
  logTick += 1;
  return createMockLogSnapshot({
    seed: 7,
    hostname: HOSTNAME,
    count,
    elapsedSeconds: logTick * (LOG_INTERVAL_MS / 1000),
  });
}

/** One fleet snapshot; incidents alternate so the grid shows healthy and failing pods. */
function containerBatch(size = 24): ContainerSnapshot {
  containerTick += 1;
  return createMockContainerSnapshot({
    seed: 11,
    size,
    elapsedSeconds: containerTick * (CONTAINER_INTERVAL_MS / 1000),
  });
}

/** One status-page snapshot; the incident window opens on every third batch. */
function uptimeBatch(size = 8): UptimeSnapshot {
  uptimeTick += 1;
  return createMockUptimeSnapshot({
    seed: 9,
    size,
    windowDays: 90,
    incident: uptimeTick % 3 === 0,
  });
}

/** Deliberately "ugly" backend shapes to prove the normalisers work. */
function flatPayload(snap: WidgetSnapshot) {
  return {
    data: {
      hostname: snap.host.name,
      platform: snap.host.platform,
      os: snap.host.os,
      uptime_seconds: snap.host.uptime,
      ip: snap.host.ip,
      region: snap.host.region,
      cpu_usage: snap.cpu.usage,
      cpu_cores: snap.cpu.cores,
      load1: snap.cpu.load[0],
      load5: snap.cpu.load[1],
      load15: snap.cpu.load[2],
      temp: snap.cpu.temperature,
      memory_total: snap.memory.total,
      memory_used: snap.memory.used,
      memory_free: snap.memory.free,
      swap_total: snap.memory.swapTotal,
      swap_used: snap.memory.swapUsed,
      disk_usage: snap.disk.usage,
      disk_total: snap.disk.total,
      disk_used: snap.disk.used,
      network: {
        rx_bps: snap.network.rxBytesPerSec,
        tx_bps: snap.network.txBytesPerSec,
        latency: snap.network.latencyMs,
      },
      processes: snap.processes.map((process) => ({
        pid: process.pid,
        name: process.name,
        cpu: process.cpu,
        rss: process.memory,
      })),
    },
  };
}

/** Container-style log lines (`severity`, `ts`, `msg`) exercised by `?shape=raw`. */
function rawLogLines(count = 20): Array<Record<string, unknown>> {
  const batch = logBatch(count);
  return batch.entries.map((entry) => ({
    severity: entry.level,
    ts: entry.timestamp,
    msg: entry.message,
    container: entry.service,
    host: entry.host,
    attrs: { region: 'eu-central-1', attempt: 1 },
  }));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    json(response, 200, { status: 'ok', uptime: process.uptime(), clients: wss.clients.size });
    return;
  }

  if (url.pathname === '/api/v1/server/metrics') {
    const snap = snapshot();
    json(response, 200, url.searchParams.get('shape') === 'flat' ? flatPayload(snap) : snap);
    return;
  }

  if (url.pathname === '/api/v1/logs') {
    json(response, 200, url.searchParams.get('shape') === 'raw' ? { logs: rawLogLines(25) } : logBatch(25));
    return;
  }

  if (url.pathname === '/api/v1/containers') {
    const snapshot = containerBatch();
    if (url.searchParams.get('shape') === 'k8s') {
      // Kubernetes-style `items` shape to prove the metadata/status alias mapping.
      json(response, 200, {
        items: snapshot.containers.map((container) => ({
          metadata: { name: container.name, namespace: container.namespace, labels: container.labels ?? {} },
          spec: { nodeName: container.node, containers: [{ name: container.spec.name, image: container.spec.image }] },
          status: {
            phase: container.phase,
            message: container.message,
            containerStatuses: [
              {
                restartCount: container.spec.restarts,
                ready: container.spec.readyContainers >= container.spec.totalContainers,
                lastTerminationReason: container.spec.lastReason,
              },
            ],
          },
          usage: { cpu: container.cpu.used, memory: container.memory.used },
          resources: { limits: { cpu: container.cpu.limit, memory: container.memory.limit } },
        })),
      });
      return;
    }
    json(response, 200, snapshot);
    return;
  }

  if (url.pathname === '/api/v1/uptime') {
    const snapshot = uptimeBatch();
    if (url.searchParams.get('shape') === 'statuspage') {
      // Statuspage style: components with code histories + incident_updates.
      json(response, 200, {
        components: snapshot.services.map((service) => ({
          id: service.id,
          name: service.name,
          group: { name: service.group ?? 'core' },
          status: service.state,
          uptime: service.uptime,
          slo: service.sloTarget,
          history: service.days
            .map((day) =>
              day.state === 'operational'
                ? 'O'
                : day.state === 'degraded'
                  ? 'D'
                  : day.state === 'partial_outage'
                    ? 'P'
                    : day.state === 'maintenance'
                      ? 'S'
                      : 'M',
            )
            .join(''),
        })),
        incidents: snapshot.incidents.map((incident) => ({
          id: incident.id,
          name: incident.title,
          impact: incident.severity,
          status: incident.state,
          created_at: new Date(incident.startedAt).toISOString(),
          ...(incident.resolvedAt ? { resolved_at: new Date(incident.resolvedAt).toISOString() } : {}),
          components: incident.services.map((id) => ({ id })),
          incident_updates: incident.updates.map((update) => ({
            status: update.state,
            body: update.message,
            created_at: new Date(update.at).toISOString(),
          })),
        })),
      });
      return;
    }
    json(response, 200, snapshot);
    return;
  }

  if (url.pathname === '/api/v1/uptime/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    response.write('retry: 2000\n\n');
    const timer = setInterval(() => {
      response.write(`event: snapshot\ndata: ${JSON.stringify(uptimeBatch())}\n\n`);
    }, UPTIME_INTERVAL_MS);
    request.on('close', () => clearInterval(timer));
    return;
  }

  if (url.pathname === '/api/v1/containers/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    response.write('retry: 2000\n\n');
    const timer = setInterval(() => {
      response.write(`event: snapshot\ndata: ${JSON.stringify(containerBatch())}\n\n`);
    }, CONTAINER_INTERVAL_MS);
    request.on('close', () => clearInterval(timer));
    return;
  }

  if (url.pathname === '/api/v1/logs/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    response.write('retry: 2000\n\n');
    const timer = setInterval(() => {
      response.write(`event: snapshot\ndata: ${JSON.stringify(logBatch())}\n\n`);
    }, LOG_INTERVAL_MS);
    request.on('close', () => clearInterval(timer));
    return;
  }

  if (url.pathname === '/api/v1/server/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    response.write('retry: 2000\n\n');
    const timer = setInterval(() => {
      response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    }, INTERVAL_MS);
    request.on('close', () => clearInterval(timer));
    return;
  }

  json(response, 404, {
    error: 'not found',
    endpoints: [
      '/api/v1/server/metrics',
      '/api/v1/server/events',
      '/stream',
      '/api/v1/logs',
      '/api/v1/logs/events',
      '/logs/stream',
      '/health',
    ],
  });
});

/**
 * One upgrade handler for both streams.
 *
 * Two `WebSocketServer` instances attached to the same HTTP server would fight
 * over the `upgrade` event (the first one aborts handshakes whose path it does
 * not own), so paths are routed manually instead.
 */
const wss = new WebSocketServer({ noServer: true });
const logWss = new WebSocketServer({ noServer: true });
const containerWss = new WebSocketServer({ noServer: true });
const uptimeWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (pathname === '/stream') {
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
    return;
  }
  if (pathname === '/logs/stream') {
    logWss.handleUpgrade(request, socket, head, (client) => logWss.emit('connection', client, request));
    return;
  }
  if (pathname === '/uptime/stream') {
    uptimeWss.handleUpgrade(request, socket, head, (client) => uptimeWss.emit('connection', client, request));
    return;
  }
  if (pathname === '/containers/stream') {
    containerWss.handleUpgrade(request, socket, head, (client) => containerWss.emit('connection', client, request));
    return;
  }
  socket.destroy();
});

wss.on('connection', (socket: WebSocket) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = (intervalMs = INTERVAL_MS) => {
    if (timer) clearInterval(timer);
    socket.send(JSON.stringify(snapshot()));
    timer = setInterval(() => socket.send(JSON.stringify(snapshot())), intervalMs);
  };

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as { type?: string; intervalMs?: number };
      if (message.type === 'ping') {
        socket.send('pong');
        return;
      }
      if (message.type === 'subscribe') {
        start(message.intervalMs ?? INTERVAL_MS);
        socket.send(JSON.stringify({ type: 'subscribed', stream: 'server-metrics' }));
      }
    } catch {
      // Ignore malformed frames: the client will retry.
    }
  });

  socket.on('close', () => {
    if (timer) clearInterval(timer);
  });

  start();
});

logWss.on('connection', (socket: WebSocket) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = (intervalMs = LOG_INTERVAL_MS) => {
    if (timer) clearInterval(timer);
    socket.send(JSON.stringify(logBatch(8)));
    timer = setInterval(() => socket.send(JSON.stringify(logBatch())), intervalMs);
  };

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as { type?: string; intervalMs?: number };
      if (message.type === 'ping') {
        socket.send('pong');
        return;
      }
      if (message.type === 'subscribe') {
        start(message.intervalMs ?? LOG_INTERVAL_MS);
        socket.send(JSON.stringify({ type: 'subscribed', stream: 'logs' }));
      }
    } catch {
      // Ignore malformed frames.
    }
  });

  socket.on('close', () => {
    if (timer) clearInterval(timer);
  });

  start();
});

/** Container fleet stream: same subscribe/ping protocol, one snapshot per tick. */
containerWss.on('connection', (socket: WebSocket) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = (intervalMs = CONTAINER_INTERVAL_MS) => {
    if (timer) clearInterval(timer);
    socket.send(JSON.stringify(containerBatch()));
    timer = setInterval(() => socket.send(JSON.stringify(containerBatch())), intervalMs);
  };

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as { type?: string; intervalMs?: number };
      if (message.type === 'ping') {
        socket.send('pong');
        return;
      }
      if (message.type === 'subscribe') {
        start(message.intervalMs ?? CONTAINER_INTERVAL_MS);
        socket.send(JSON.stringify({ type: 'subscribed', stream: 'containers' }));
      }
    } catch {
      // Ignore malformed frames.
    }
  });

  socket.on('close', () => {
    if (timer) clearInterval(timer);
  });

  start();
});

/** Uptime stream: same subscribe/ping protocol, one status page per tick. */
uptimeWss.on('connection', (socket: WebSocket) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = (intervalMs = UPTIME_INTERVAL_MS) => {
    if (timer) clearInterval(timer);
    socket.send(JSON.stringify(uptimeBatch()));
    timer = setInterval(() => socket.send(JSON.stringify(uptimeBatch())), intervalMs);
  };

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as { type?: string; intervalMs?: number };
      if (message.type === 'ping') {
        socket.send('pong');
        return;
      }
      if (message.type === 'subscribe') {
        start(message.intervalMs ?? UPTIME_INTERVAL_MS);
        socket.send(JSON.stringify({ type: 'subscribed', stream: 'uptime' }));
      }
    } catch {
      // Ignore malformed frames.
    }
  });

  socket.on('close', () => {
    if (timer) clearInterval(timer);
  });

  start();
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`[mock-server] listening on ${base}`);
  console.log(`  metrics (snapshot) : ${base}/api/v1/server/metrics`);
  console.log(`  metrics (flat)     : ${base}/api/v1/server/metrics?shape=flat`);
  console.log(`  metrics SSE        : ${base}/api/v1/server/events`);
  console.log(`  metrics WebSocket  : ws://localhost:${PORT}/stream`);
  console.log(`  logs (batch)       : ${base}/api/v1/logs`);
  console.log(`  logs (raw lines)   : ${base}/api/v1/logs?shape=raw`);
  console.log(`  logs SSE           : ${base}/api/v1/logs/events`);
  console.log(`  logs WebSocket     : ws://localhost:${PORT}/logs/stream`);
  console.log(`  containers         : ${base}/api/v1/containers`);
  console.log(`  containers (k8s)   : ${base}/api/v1/containers?shape=k8s`);
  console.log(`  containers SSE     : ${base}/api/v1/containers/events`);
  console.log(`  containers WS      : ws://localhost:${PORT}/containers/stream`);
  console.log(`  uptime (status page) : ${base}/api/v1/uptime`);
  console.log(`  uptime (statuspage)  : ${base}/api/v1/uptime?shape=statuspage`);
  console.log(`  uptime SSE           : ${base}/api/v1/uptime/events`);
  console.log(`  uptime WS            : ws://localhost:${PORT}/uptime/stream`);
});
