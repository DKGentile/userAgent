/**
 * All HTTP routes, mounted under /api by the single Aegis server.
 */
import type { FastifyInstance } from 'fastify';
import { getClaim, getDocuments, getLastDecision, listClaims, listKnowledge } from './db/repos.js';
import { resolveTracking } from './services/tracking.js';
import { analyzeClaimDocuments } from './services/documentAnalyzer.js';
import { semanticSearch } from './services/rag.js';
import { runBacktest } from './services/backtest.js';
import { getCapabilities, getDashboardStats } from './services/stats.js';
import { runAgent } from './services/agent/engine.js';
import type { AgentEvent } from '@shared';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/capabilities', async () => getCapabilities());
  app.get('/stats', async () => getDashboardStats());

  app.get('/claims', async (req) => {
    const q = req.query as { status?: string; type?: string; q?: string };
    return listClaims({ status: q.status, type: q.type, q: q.q });
  });

  app.get('/claims/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const claim = getClaim(id);
    if (!claim) return reply.code(404).send({ error: 'claim not found' });
    return {
      claim,
      documents: getDocuments(id),
      tracking: resolveTracking({ ...claim, carrierCode: claim.carrierCode }),
      lastDecision: getLastDecision(id),
    };
  });

  app.post('/claims/:id/documents/analyze', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!getClaim(id)) return reply.code(404).send({ error: 'claim not found' });
    return analyzeClaimDocuments(id, true);
  });

  app.get('/search', async (req, reply) => {
    const q = (req.query as { q?: string }).q?.trim();
    if (!q) return reply.code(400).send({ error: 'missing q' });
    return semanticSearch(q, 8);
  });

  app.get('/knowledge', async () => listKnowledge(false));

  app.post('/backtest', async () => runBacktest());

  // --- Live agent run (Server-Sent Events) -------------------------------
  app.get('/claims/:id/agent/stream', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    req.raw.on('close', () => {
      closed = true;
    });
    const emit = (e: AgentEvent) => {
      if (!closed) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    try {
      if (!getClaim(id)) {
        emit({ type: 'error', message: `Claim ${id} not found` });
        emit({ type: 'done' });
      } else {
        await runAgent(id, emit, { persist: true, stream: true });
      }
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!closed) res.end();
    }
  });
}
