import { useState } from 'react';
import { motion } from 'framer-motion';
import { ScanSearch, Sparkles } from 'lucide-react';
import type { KnowledgeCategory, SemanticSearchResponse } from '@shared';
import { api } from '@/lib/api';
import { cn, pct } from '@/lib/cn';
import { Card, Spinner } from '@/components/ui';

const CAT_COLOR: Record<KnowledgeCategory, string> = {
  coverage_rule: '#38bdf8',
  exclusion: '#fb7185',
  procedure: '#fbbf24',
  precedent: '#a78bfa',
};
const CAT_LABEL: Record<KnowledgeCategory, string> = {
  coverage_rule: 'Coverage rule',
  exclusion: 'Exclusion',
  procedure: 'Procedure',
  precedent: 'Precedent',
};

const EXAMPLES = [
  'parcel smashed in transit, box crushed',
  'buyer never received it, tracking went quiet',
  'loose diamond shipped on its own',
  'delivered but signed for — porch theft',
  'expensive rug lost overseas',
  'carton arrived light, pieces missing',
];

// map coord in [-1,1] -> svg [pad, 100-pad]
const toView = (c: number) => 50 + c * 42;

export default function SemanticSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SemanticSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const search = (query: string) => {
    const text = query.trim();
    if (!text) return;
    setQ(text);
    setLoading(true);
    api.search(text).then((r) => { setRes(r); setLoading(false); }).catch(() => setLoading(false));
  };

  const matchedIds = new Set(res?.results.map((r) => r.chunkId));

  return (
    <div className="space-y-5">
      <header>
        <div className="label mb-1">Retrieval-Augmented Generation</div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Semantic Search</h1>
        <p className="mt-1 text-sm text-muted">
          Embed a query, cosine-rank it against the knowledge base, and watch where it lands in vector space. This is the
          same retrieval the agent runs before it reasons.
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); search(q); }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <ScanSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Describe a claim situation in plain language…"
            className="w-full rounded-xl border border-line bg-ink-850 py-3 pl-10 pr-3 text-sm text-slate-200 outline-none placeholder:text-muted focus:border-brand-500/60"
          />
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <Spinner /> : <Sparkles className="h-4 w-4" />} Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => search(ex)} className="chip border-line text-muted transition-colors hover:border-brand-500/50 hover:text-slate-200">
            {ex}
          </button>
        ))}
      </div>

      {res && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Ranked results */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{res.results.length} matches</span>
              <span className="font-mono">{res.provider} · {res.dims}d · {res.tookMs}ms</span>
            </div>
            {res.results.map((r, i) => (
              <motion.div
                key={r.chunkId}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                onMouseEnter={() => setHover(r.chunkId)}
                onMouseLeave={() => setHover(null)}
              >
                <Card className={cn('card-pad transition-colors', hover === r.chunkId && 'border-brand-500/50')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted">#{i + 1}</span>
                      <span className="text-sm font-medium text-slate-200">{r.title}</span>
                    </div>
                    <span className="chip shrink-0 font-mono" style={{ borderColor: `${CAT_COLOR[r.category]}55`, color: CAT_COLOR[r.category], background: `${CAT_COLOR[r.category]}14` }}>
                      {pct(r.score, 0)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    <span className="h-2 w-2 rounded-sm" style={{ background: CAT_COLOR[r.category] }} />
                    {CAT_LABEL[r.category]} · {r.source}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{r.text}</p>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Vector-space map */}
          <Card className="card-pad lg:sticky lg:top-6 self-start">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">Vector space (PCA → 2-D)</h2>
              <span className="text-[11px] text-muted">{res.cloud.length} chunks</span>
            </div>
            <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line/60 bg-ink-900/60 grid-bg">
              <svg viewBox="0 0 100 100" className="h-full w-full">
                {/* connection lines from query to matches */}
                {res.results.map((r) => (
                  <line
                    key={`l-${r.chunkId}`}
                    x1={toView(res.queryPoint.x)}
                    y1={toView(-res.queryPoint.y)}
                    x2={toView(r.x)}
                    y2={toView(-r.y)}
                    stroke="#6366f1"
                    strokeOpacity={hover === null || hover === r.chunkId ? 0.25 : 0.05}
                    strokeWidth={0.25}
                  />
                ))}
                {/* all chunks */}
                {res.cloud.map((p) => {
                  const matched = matchedIds.has(p.id);
                  return (
                    <circle
                      key={p.id}
                      cx={toView(p.x)}
                      cy={toView(-p.y)}
                      r={matched ? 1.7 : 1}
                      fill={CAT_COLOR[p.category]}
                      fillOpacity={matched ? 1 : 0.35}
                      stroke={hover === p.id ? '#fff' : 'none'}
                      strokeWidth={0.4}
                      onMouseEnter={() => setHover(p.id)}
                      onMouseLeave={() => setHover(null)}
                      style={{ transition: 'r .2s' }}
                    >
                      <title>{p.title}</title>
                    </circle>
                  );
                })}
                {/* query point */}
                <g>
                  <circle cx={toView(res.queryPoint.x)} cy={toView(-res.queryPoint.y)} r={3.4} fill="none" stroke="#22d3ee" strokeWidth={0.5} className="animate-ping" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
                  <circle cx={toView(res.queryPoint.x)} cy={toView(-res.queryPoint.y)} r={2} fill="#22d3ee" />
                </g>
              </svg>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
              {(Object.keys(CAT_COLOR) as KnowledgeCategory[]).map((c) => (
                <span key={c} className="flex items-center gap-1.5 text-muted">
                  <span className="h-2 w-2 rounded-sm" style={{ background: CAT_COLOR[c] }} />
                  {CAT_LABEL[c]}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full bg-cyanide" />query</span>
            </div>
          </Card>
        </div>
      )}

      {!res && !loading && (
        <Card className="card-pad">
          <p className="text-center text-sm text-muted">Run a search to see ranked matches and the 2-D projection of the embedding space.</p>
        </Card>
      )}
    </div>
  );
}
