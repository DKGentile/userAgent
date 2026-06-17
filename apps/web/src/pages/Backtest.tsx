import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Radar, ShieldAlert, X } from 'lucide-react';
import { DECISION_LABELS, type BacktestSummary, type DecisionKind } from '@shared';
import { api } from '@/lib/api';
import { cn, pct } from '@/lib/cn';
import { Card, DecisionBadge, Spinner } from '@/components/ui';

const KINDS: DecisionKind[] = ['approve', 'deny', 'request_docs', 'escalate'];
const SHORT: Record<DecisionKind, string> = { approve: 'APPR', deny: 'DENY', request_docs: 'DOCS', escalate: 'ESC' };

export default function Backtest() {
  const [res, setRes] = useState<BacktestSummary | null>(null);
  const [running, setRunning] = useState(false);

  const run = () => {
    setRunning(true);
    api.backtest().then((r) => { setRes(r); setRunning(false); }).catch(() => setRunning(false));
  };

  const maxCell = res ? Math.max(1, ...KINDS.flatMap((t) => KINDS.map((p) => res.matrix[t][p]))) : 1;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label mb-1">Evaluation Harness</div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Backtest</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Re-runs the current agent over every claim with a human ground-truth label and scores agreement. The entire
            run executes with the database <span className="text-slate-300">write-guard armed</span> — scoped to the
            single eval table — so an evaluation can never mutate live claims.
          </p>
        </div>
        <button onClick={run} disabled={running} className="btn-primary">
          {running ? <><Spinner /> Running…</> : <><Radar className="h-4 w-4" /> Run backtest</>}
        </button>
      </header>

      {!res && !running && (
        <Card className="card-pad">
          <div className="flex items-center gap-3 text-sm text-muted">
            <ShieldAlert className="h-5 w-5 text-request" />
            Run the backtest to score the agent against the adjudicator ground truth and view the agreement matrix.
          </div>
        </Card>
      )}

      {res && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Accuracy" value={pct(res.accuracy, 1)} big tone={res.accuracy >= 0.9 ? 'good' : 'brand'} />
            <Metric label="Agreed" value={`${res.agreed} / ${res.total}`} />
            <Metric label="Avg confidence" value={pct(res.avgConfidence)} />
            <Metric label="Avg latency" value={`${Math.round(res.avgTookMs)} ms`} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
            {/* Confusion matrix */}
            <Card className="card-pad">
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Agreement matrix</h2>
              <div className="inline-grid" style={{ gridTemplateColumns: `auto repeat(${KINDS.length}, 2.6rem)` }}>
                <div />
                {KINDS.map((p) => (
                  <div key={p} className="pb-1 text-center text-[10px] font-semibold text-muted">{SHORT[p]}</div>
                ))}
                {KINDS.map((t) => (
                  <Row key={t} t={t} matrix={res.matrix} maxCell={maxCell} />
                ))}
              </div>
              <div className="mt-3 text-[11px] text-muted">
                rows = adjudicator truth · columns = agent decision · diagonal = agreement
              </div>
            </Card>

            {/* Per-claim rows */}
            <Card className="overflow-hidden">
              <div className="grid grid-cols-[1fr_1.6fr_auto_auto_auto] items-center gap-3 border-b border-line/70 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <span>Reference</span>
                <span>Item</span>
                <span className="text-center">Truth</span>
                <span className="text-center">Agent</span>
                <span className="text-center">Conf</span>
              </div>
              <div className="max-h-[420px] divide-y divide-line/50 overflow-y-auto">
                {res.rows.map((r, i) => (
                  <motion.div
                    key={r.claimId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.01 }}
                    className={cn('grid grid-cols-[1fr_1.6fr_auto_auto_auto] items-center gap-3 px-4 py-2.5', !r.agree && 'bg-deny/5')}
                    title={r.groundTruthNote ?? ''}
                  >
                    <span className="flex items-center gap-2 font-mono text-xs text-slate-300">
                      {r.agree ? <Check className="h-3.5 w-3.5 text-approve" /> : <X className="h-3.5 w-3.5 text-deny" />}
                      {r.publicRef}
                    </span>
                    <span className="truncate text-xs text-slate-400">{r.itemDescription}</span>
                    <span className="flex justify-center"><DecisionBadge decision={r.groundTruth} /></span>
                    <span className="flex justify-center"><DecisionBadge decision={r.agentDecision} /></span>
                    <span className="text-center font-mono text-xs text-muted">{pct(r.agentConfidence, 0)}</span>
                  </motion.div>
                ))}
              </div>
            </Card>
          </div>

          {res.rows.some((r) => !r.agree) && (
            <Card className="card-pad border-deny/30">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300"><X className="h-4 w-4 text-deny" />Disagreements ({res.rows.filter((r) => !r.agree).length})</h2>
              <div className="space-y-2">
                {res.rows.filter((r) => !r.agree).map((r) => (
                  <div key={r.claimId} className="rounded-xl border border-line/70 bg-ink-800/40 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-slate-300">{r.publicRef}</span>
                      <span className="text-muted">— {r.itemDescription}</span>
                    </div>
                    <div className="mb-1.5 flex items-center gap-2">
                      truth <DecisionBadge decision={r.groundTruth} /> vs agent <DecisionBadge decision={r.agentDecision} />
                    </div>
                    {r.groundTruthNote && <p className="leading-relaxed text-muted">{r.groundTruthNote}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Row({ t, matrix, maxCell }: { t: DecisionKind; matrix: BacktestSummary['matrix']; maxCell: number }) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-[10px] font-semibold text-muted">{SHORT[t]}</div>
      {KINDS.map((p) => {
        const n = matrix[t][p];
        const diag = t === p;
        const intensity = n / maxCell;
        const bg = n === 0 ? 'transparent' : diag ? `rgba(52,211,153,${0.15 + intensity * 0.6})` : `rgba(251,113,133,${0.15 + intensity * 0.6})`;
        return (
          <div key={p} className="m-0.5 grid h-9 place-items-center rounded-md border border-line/40 font-mono text-xs text-slate-200" style={{ background: bg }}>
            {n || ''}
          </div>
        );
      })}
    </>
  );
}

function Metric({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: 'good' | 'brand' }) {
  return (
    <Card className="card-pad">
      <div className="label mb-2">{label}</div>
      <div className={cn('font-mono font-semibold tabular-nums', big ? 'text-4xl' : 'text-2xl', tone === 'good' ? 'text-approve' : tone === 'brand' ? 'text-brand-400' : 'text-white')}>
        {value}
      </div>
    </Card>
  );
}
