/**
 * Evaluation harness. Re-runs the CURRENT agent over every claim that has a
 * human-recorded ground-truth decision and scores agreement, producing a
 * confusion matrix. The entire run executes with the DB WRITE-GUARD armed and
 * scoped to the single `backtest_runs` table — proving an evaluation can never
 * mutate live claim data (the safety-net pattern from the production agent).
 */
import { withWriteGuardAsync } from '../db/connection.js';
import { claimsWithGroundTruth, insertBacktestRun } from '../db/repos.js';
import { decideClaim } from './agent/engine.js';
import type { BacktestRow, BacktestSummary, DecisionKind } from '@shared';

const KINDS: DecisionKind[] = ['approve', 'deny', 'request_docs', 'escalate'];

function emptyMatrix(): Record<DecisionKind, Record<DecisionKind, number>> {
  const m = {} as Record<DecisionKind, Record<DecisionKind, number>>;
  for (const t of KINDS) {
    m[t] = {} as Record<DecisionKind, number>;
    for (const p of KINDS) m[t][p] = 0;
  }
  return m;
}

export async function runBacktest(): Promise<BacktestSummary> {
  const claims = claimsWithGroundTruth();
  const rows: BacktestRow[] = [];
  const matrix = emptyMatrix();

  // The guard is armed for the WHOLE evaluation: decideClaim runs with
  // persistence off, and any stray write to a live table would throw here.
  await withWriteGuardAsync(['backtest_runs'], async () => {
    for (const c of claims) {
      const truth = c.groundTruthDecision!;
      const d = await decideClaim(c.id);
      matrix[truth][d.decision] += 1;
      rows.push({
        claimId: c.id,
        publicRef: c.publicRef,
        itemDescription: c.itemDescription,
        groundTruth: truth,
        groundTruthNote: c.groundTruthNote,
        agentDecision: d.decision,
        agentConfidence: d.confidence,
        agree: d.decision === truth,
        tookMs: d.tookMs,
      });
    }

    const total = rows.length;
    const agreed = rows.filter((r) => r.agree).length;
    const summary: BacktestSummary = {
      runId: `bt_${Date.now()}`,
      total,
      agreed,
      accuracy: total ? agreed / total : 0,
      matrix,
      rows,
      avgConfidence: total ? rows.reduce((s, r) => s + r.agentConfidence, 0) / total : 0,
      avgTookMs: total ? rows.reduce((s, r) => s + r.tookMs, 0) / total : 0,
      finishedAt: new Date().toISOString(),
    };
    insertBacktestRun(summary); // allowed table — passes the guard
    _last = summary;
  });

  return _last!;
}

let _last: BacktestSummary | null = null;
