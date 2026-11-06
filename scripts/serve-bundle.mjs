#!/usr/bin/env node
/**
 * Bundle smoke test.
 *
 * Serves the *shipped* IIFE bundle (`dist/server-monitor.global.js`) with a tiny
 * HTML harness so the exact artifact consumed by WebView hosts can be verified
 * in a real browser:
 *
 *   node scripts/serve-bundle.mjs            # http://127.0.0.1:4320
 *   node scripts/serve-bundle.mjs --port 5000 --source ws://localhost:4310/stream
 *
 * The harness exposes `window.__widgets` and forwards widget events to the
 * console, which makes it usable both for manual inspection and for headless
 * screenshots (`chromium --headless --screenshot=… http://127.0.0.1:4320`).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', 'packages', 'server-monitor');
const bundlePath = path.join(packageRoot, 'dist', 'server-monitor.global.js');

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const port = Number(readFlag('port', process.env.PORT ?? 4320));
const source = readFlag('source', process.env.SOURCE ?? 'ws://localhost:4310/stream');
const theme = readFlag('theme', 'dark');
const locale = readFlag('locale', 'en');

function harness() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Widgets · bundle smoke test</title>
    <style>
      html, body { margin: 0; height: 100%; background: #101725; color: #eef1f7;
        font-family: Inter, "Segoe UI", system-ui, sans-serif; }
      server-monitor { display: block; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <server-monitor id="monitor"></server-monitor>
    <script src="/server-monitor.global.js"></script>
    <script>
      // The IIFE self-registers the element on load.
      customElements.whenDefined('server-monitor').then(() => {
        const widget = document.getElementById('monitor');
        window.__widgets = widget;
        widget.setConfig({
          source: { transport: 'websocket', url: ${JSON.stringify(source)} },
          theme: ${JSON.stringify(theme)},
          locale: ${JSON.stringify(locale)}
        });
        widget.addEventListener('widget-snapshot', (event) => {
          document.title = 'live · ' + event.detail.host.name;
        });
        widget.addEventListener('widget-action', (event) => console.log('action', event.detail));
        widget.addEventListener('widget-error', (event) => console.error('error', event.detail));
      });
    </script>
  </body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const body = harness();
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    response.end(body);
    return;
  }

  if (url.pathname === '/server-monitor.global.js' || url.pathname === '/server-monitor.global.js.map') {
    try {
      const body = await readFile(path.join(packageRoot, 'dist', path.basename(url.pathname)));
      response.writeHead(200, {
        'content-type': url.pathname.endsWith('.map') ? 'application/json' : 'text/javascript',
        'content-length': body.byteLength,
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end(`bundle not found — run: npm run build --workspace @widgets/server-monitor\n${error.message}`);
    }
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[bundle-smoke] http://127.0.0.1:${port}  (source: ${source}, theme: ${theme})`);
  console.log('[bundle-smoke] screenshot: chromium --headless=new --screenshot=shot.png \\');
  console.log(`                             --virtual-time-budget=15000 http://127.0.0.1:${port}`);
});
