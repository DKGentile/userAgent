import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { motion } from 'framer-motion';
import { Activity, ArrowUpRight, FileCheck2, Layers, ShieldCheck, Wallet } from 'lucide-react';
import { CLAIM_STATUS_LABELS, type ClaimStatus, type DecisionKind } from '@shared';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { pct, shortDate, usd } from '@/lib/cn';
import { Card, ConfidenceBar, DecisionBadge, Spinner } from '@/components/ui';

const STATUS_COLOR: Record<ClaimStatus, string> = {
  new: '#64748b',
  in_review: '#22d3ee',
  awaiting_docs: '#fbbf24',
  pending_signoff: '#6366f1',
  approved: '#34d399',
  denied: '#fb7185',
  escalated: '#a78bfa',
};
const TYPE_COLOR: Record<string, string> = { loss: '#38bdf8', damage: '#fb7185', shortage: '#fbbf24' };

export default function Dashboard() {
  const { data, loading } = useApi(() => api.stats(), []);

  if (loading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const statusData = (Object.keys(data.byStatus) as ClaimStatus[])
    .filter((s) => data.byStatus[s] > 0)
    .map((s) => ({ name: CLAIM_STATUS_LABELS[s], value: data.byStatus[s], color: STATUS_COLOR[s] }));
  const typeData = Object.entries(data.byType)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v, color: TYPE_COLOR[k] }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label mb-1">Operations Console</div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Autonomous Claims Intelligence</h1>
          <p className="mt-1 text-sm text-muted">
            Agentic adjudication over a synthetic shipping-insurance book — SQL, document analysis, RAG, and guard-railed decisions.
          </p>
        </div>
        <Link to="/claims" className="btn-primary">
          Open claims queue <ArrowUpRight className="h-4 w-4" />
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat icon={Layers} label="Total claims" value={String(data.totalClaims)} />
        <Stat icon={Wallet} label="Open exposure" value={usd(data.openExposure)} />
        <Stat icon={FileCheck2} label="Approved payout" value={usd(data.approvedPayout)} tone="good" />
        <Stat icon={Activity} label="Decided by agent" value={String(data.decidedByAgent)} />
        <Stat icon={ShieldCheck} label="Avg confidence" value={pct(data.avgConfidence)} tone="brand" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="card-pad lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">Recent agent decisions</h2>
            <span className="text-xs text-muted">latest {data.recentDecisions.length}</span>
          </div>
          <div className="divide-y divide-line/60">
            {data.recentDecisions.map((d) => (
              <Link
                key={`${d.claimId}-${d.decidedAt}`}
                to={`/claims/${d.claimId}`}
                className="group flex items-center justify-between gap-4 py-2.5 transition-colors hover:bg-ink-800/40"
              >
                <div className="flex items-center gap-3">
                  <DecisionBadge decision={d.decision as DecisionKind} />
                  <span className="font-mono text-sm text-slate-300">{d.publicRef}</span>
                </div>
                <div className="flex items-center gap-4">
                  <ConfidenceBar value={d.confidence} />
                  <span className="w-24 text-right text-xs text-muted">{shortDate(d.decidedAt)}</span>
                </div>
              </Link>
            ))}
            {data.recentDecisions.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">No decisions yet — run the agent on a claim.</p>
            )}
          </div>
        </Card>

        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Claims by status</h2>
          <Donut data={statusData} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Claims by type</h2>
          <Donut data={typeData} />
        </Card>
        <Card className="card-pad lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">System capabilities</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <CapTile label="Decision model" value={data.capabilities.llm.model} sub={data.capabilities.llm.provider} live={data.capabilities.llm.provider === 'anthropic'} />
            <CapTile label="Embeddings" value={`${data.capabilities.embeddings.dims}-dim`} sub={data.capabilities.embeddings.provider} live={data.capabilities.embeddings.provider !== 'feature-hash'} />
            <CapTile label="Database" value="SQL" sub={data.capabilities.database.driver} live />
            <CapTile label="Knowledge base" value={`${data.capabilities.knowledgeChunks}`} sub="RAG chunks" live />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            The agent runs fully offline by default (deterministic reasoner + feature-hashing embeddings). Add an
            <code className="mx-1 rounded bg-ink-800 px-1.5 py-0.5 text-slate-300">ANTHROPIC_API_KEY</code>
            for real Claude tool-use with extended thinking, or an embeddings key for production vectors — no code changes.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'brand';
}) {
  const ring =
    tone === 'good' ? 'text-approve' : tone === 'brand' ? 'text-brand-400' : 'text-slate-400';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="card-pad">
        <div className="mb-3 flex items-center justify-between">
          <span className="label">{label}</span>
          <Icon className={`h-4 w-4 ${ring}`} />
        </div>
        <div className="stat-num">{value}</div>
      </Card>
    </motion.div>
  );
}

function CapTile({ label, value, sub, live }: { label: string; value: string; sub: string; live?: boolean }) {
  return (
    <div className="rounded-xl border border-line/70 bg-ink-800/50 p-3">
      <div className="label">{label}</div>
      <div className="mt-1 truncate font-mono text-sm text-white">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-approve' : 'bg-slate-500'}`} />
        <span className="truncate">{sub}</span>
      </div>
    </div>
  );
}

function Donut({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#0d121d', border: '1px solid #1f2a3c', borderRadius: 12, fontSize: 12 }}
              itemStyle={{ color: '#e5e9f0' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-semibold text-white">{total}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted">total</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 capitalize text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
              {d.name}
            </span>
            <span className="font-mono text-muted">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
