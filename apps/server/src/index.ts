/**
 * Aegis — the single server. One process serves:
 *   - the JSON + SSE API under /api
 *   - the React single-page app (everything else)
 *   - and owns the database + vector store.
 *
 * In development it also runs Vite in-process (build --watch) and live-reloads
 * the browser, so there is exactly ONE server to run and ONE service to deploy
 * on AWS. See README "Going to production on AWS".
 */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { Config, WEB_ROOT } from './config.js';
import { getDb, isSeeded } from './db/connection.js';
import { seedIfEmpty } from './db/seed.js';
import { initVectorStore } from './services/vectorStore.js';
import { getCapabilities } from './services/stats.js';
import { registerRoutes } from './routes.js';

const WEB_DIST = path.join(WEB_ROOT, 'dist');

// --- dev live-reload broadcaster ------------------------------------------
const reloadClients = new Set<import('node:http').ServerResponse>();
function broadcastReload(): void {
  for (const res of reloadClients) res.write('data: reload\n\n');
}

function indexHtml(): string {
  const file = path.join(WEB_DIST, 'index.html');
  if (!fs.existsSync(file)) {
    return `<!doctype html><html><body style="font-family:system-ui;background:#0a0e17;color:#e5e9f0;padding:3rem">
      <h1>Aegis</h1><p>The web bundle has not been built yet. Run <code>npm run build</code> (production) or <code>npm run dev</code> (development).</p></body></html>`;
  }
  let html = fs.readFileSync(file, 'utf8');
  if (!Config.IS_PROD) {
    const livereload = `<script>(function(){try{var es=new EventSource('/api/dev/livereload');es.onmessage=function(e){if(e.data==='reload')location.reload();};}catch(_){}})();</script>`;
    html = html.replace('</body>', `${livereload}</body>`);
  }
  return html;
}

async function startDevAssets(): Promise<void> {
  const vite = await import('vite');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const watcher: any = await vite.build({ root: WEB_ROOT, logLevel: 'warn', build: { watch: {} } });
  await new Promise<void>((resolve) => {
    let first = true;
    watcher.on('event', (e: { code: string; error?: Error }) => {
      if (e.code === 'END') {
        if (first) {
          first = false;
          resolve();
        } else {
          broadcastReload();
        }
      } else if (e.code === 'ERROR') {
        // eslint-disable-next-line no-console
        console.error('[vite] build error:', e.error?.message);
        if (first) {
          first = false;
          resolve();
        }
      }
    });
  });
}

async function boot(): Promise<void> {
  // 1. Database — migrate + seed-if-empty, then build the vector index.
  const db = getDb();
  const fresh = seedIfEmpty(db);
  await initVectorStore();
  const caps = getCapabilities();

  // 2. Web assets in dev (Vite in-process build --watch + live reload).
  if (!Config.IS_PROD) {
    process.stdout.write('▸ Building the web app (Vite)…\n');
    await startDevAssets();
  }

  // 3. HTTP server (API + SPA, one port).
  const app = Fastify({ logger: false });
  await app.register(registerRoutes, { prefix: '/api' });

  // dev live-reload stream
  app.get('/api/dev/livereload', (req, reply) => {
    if (Config.IS_PROD) return reply.code(404).send();
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reloadClients.add(reply.raw);
    req.raw.on('close', () => reloadClients.delete(reply.raw));
  });

  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', wildcard: false, index: false });
  }
  // SPA fallback: anything not under /api and not a static file -> index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.code(200).type('text/html').send(indexHtml());
  });

  await app.listen({ port: Config.PORT, host: '0.0.0.0' });

  banner(caps, fresh);
}

function banner(caps: ReturnType<typeof getCapabilities>, fresh: boolean): void {
  const line = '─'.repeat(58);
  /* eslint-disable no-console */
  console.log(`\n┌${line}┐`);
  console.log(`│  Aegis · Autonomous Claims Intelligence`);
  console.log(`│  ${'http://localhost:' + Config.PORT}`);
  console.log(`├${line}┤`);
  console.log(`│  LLM         ${caps.llm.provider} · ${caps.llm.model}`);
  console.log(`│  Embeddings  ${caps.embeddings.provider} · ${caps.embeddings.dims}d`);
  console.log(`│  Database    ${caps.database.driver}${fresh ? ' (seeded)' : ''}`);
  console.log(`│  Knowledge   ${caps.knowledgeChunks} chunks indexed`);
  console.log(`│  Mode        ${Config.IS_PROD ? 'production' : 'development (HMR via live-reload)'}`);
  console.log(`└${line}┘\n`);
  /* eslint-enable no-console */
}

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal boot error:', err);
  process.exit(1);
});

// quiet unused-import guard for isSeeded (exported for tooling/tests)
void isSeeded;
