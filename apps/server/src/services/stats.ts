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
  for (const r of db.all<{ status: ClaimStatus; n: number }>('SELECT lifecycle_state AS status, COUNT(*) AS n FROM cases GROUP BY lifecycle_state')) {
    byStatus[r.status] = r.n;
  }

  const byType = { loss: 0, damage: 0, shortage: 0 } as Record<ClaimType, number>;
  for (const r of db.all<{ type: ClaimType; n: number }>('SELECT peril AS type, COUNT(*) AS n FROM cases GROUP BY peril')) {
    byType[r.type] = r.n;
  }

  const totalClaims = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cases')?.n ?? 0;

  const openExposure =
    db.get<{ s: number }>(
      `SELECT COALESCE(SUM(coverage_limit_usd), 0) AS s FROM cases WHERE lifecycle_state IN (${OPEN_STATUSES.map(() => '?').join(',')})`,
      OPEN_STATUSES,
    )?.s ?? 0;

  // Latest adjudication per case
  const latestFilter = 'adjudication_id IN (SELECT MAX(adjudication_id) FROM adjudications GROUP BY case_id)';
  const approvedPayout =
    db.get<{ s: number }>(`SELECT COALESCE(SUM(award_usd), 0) AS s FROM adjudications WHERE verdict='approve' AND ${latestFilter}`)?.s ?? 0;
  const decidedByAgent = db.get<{ n: number }>('SELECT COUNT(DISTINCT case_id) AS n FROM adjudications')?.n ?? 0;
  const avgConfidence = db.get<{ a: number }>(`SELECT COALESCE(AVG(certainty), 0) AS a FROM adjudications WHERE ${latestFilter}`)?.a ?? 0;

  const recentDecisions = db
    .all<{ claim_id: number; public_ref: string; decision: DecisionKind; confidence: number; decided_at: string }>(
      `SELECT a.case_id AS claim_id, c.case_ref AS public_ref, a.verdict AS decision, a.certainty AS confidence, a.ruled_at AS decided_at
       FROM adjudications a JOIN cases c ON c.case_id = a.case_id
       ORDER BY a.ruled_at DESC, a.adjudication_id DESC LIMIT 8`,
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
