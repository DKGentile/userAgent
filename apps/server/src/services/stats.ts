/**
 * Dashboard aggregates + system capability provenance (so the UI can show what
 * is actually live: real Claude vs simulator, which embedding provider, etc.).
 */
import { getDb } from '../db/connection.js';
import { listKnowledge } from '../db/repos.js';
import { getEmbeddingProvider } from './embeddings.js';
import { llmInfo } from './llm.js';
import { CLAIM_STATUS_LABELS, type ClaimStatus, type ClaimType, type DashboardStats, type DecisionKind, type SystemCapabilities } from '@shared';

const OPEN_STATUSES: ClaimStatus[] = ['new', 'in_review', 'awaiting_docs', 'pending_signoff', 'escalated'];

export function getCapabilities(): SystemCapabilities {
  const emb = getEmbeddingProvider();
  return {
    llm: llmInfo(),
    embeddings: { provider: emb.name, dims: emb.dims },
    database: { driver: getDb().driverName },
    knowledgeChunks: listKnowledge(false).length,
  };
}

export function getDashboardStats(): DashboardStats {
  const db = getDb();

  const byStatus = Object.fromEntries(
    (Object.keys(CLAIM_STATUS_LABELS) as ClaimStatus[]).map((s) => [s, 0]),
  ) as Record<ClaimStatus, number>;
  for (const r of db.all<{ status: ClaimStatus; n: number }>('SELECT status, COUNT(*) AS n FROM claims GROUP BY status')) {
    byStatus[r.status] = r.n;
  }

  const byType = { loss: 0, damage: 0, shortage: 0 } as Record<ClaimType, number>;
  for (const r of db.all<{ type: ClaimType; n: number }>('SELECT type, COUNT(*) AS n FROM claims GROUP BY type')) {
    byType[r.type] = r.n;
  }

  const totalClaims = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM claims')?.n ?? 0;

  const openExposure =
    db.get<{ s: number }>(
      `SELECT COALESCE(SUM(insured_amount), 0) AS s FROM claims WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})`,
      OPEN_STATUSES,
    )?.s ?? 0;

  // Latest decision per claim
  const latestFilter = 'id IN (SELECT MAX(id) FROM agent_decisions GROUP BY claim_id)';
  const approvedPayout =
    db.get<{ s: number }>(`SELECT COALESCE(SUM(paid_amount), 0) AS s FROM agent_decisions WHERE decision='approve' AND ${latestFilter}`)?.s ?? 0;
  const decidedByAgent = db.get<{ n: number }>('SELECT COUNT(DISTINCT claim_id) AS n FROM agent_decisions')?.n ?? 0;
  const avgConfidence = db.get<{ a: number }>(`SELECT COALESCE(AVG(confidence), 0) AS a FROM agent_decisions WHERE ${latestFilter}`)?.a ?? 0;

  const recentDecisions = db
    .all<{ claim_id: number; public_ref: string; decision: DecisionKind; confidence: number; decided_at: string }>(
      `SELECT ad.claim_id, c.public_ref, ad.decision, ad.confidence, ad.decided_at
       FROM agent_decisions ad JOIN claims c ON c.id = ad.claim_id
       ORDER BY ad.decided_at DESC, ad.id DESC LIMIT 8`,
    )
    .map((r) => ({ claimId: r.claim_id, publicRef: r.public_ref, decision: r.decision, confidence: r.confidence, decidedAt: r.decided_at }));

  return {
    totalClaims,
    byStatus,
    byType,
    openExposure,
    approvedPayout,
    decidedByAgent,
    avgConfidence,
    recentDecisions,
    capabilities: getCapabilities(),
  };
}
