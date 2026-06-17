import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen } from 'lucide-react';
import type { KnowledgeCategory } from '@shared';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { Card, Spinner } from '@/components/ui';

const CAT_COLOR: Record<KnowledgeCategory, string> = {
  coverage_rule: '#38bdf8',
  exclusion: '#fb7185',
  procedure: '#fbbf24',
  precedent: '#a78bfa',
};
const CAT_LABEL: Record<KnowledgeCategory, string> = {
  coverage_rule: 'Coverage rules',
  exclusion: 'Exclusions',
  procedure: 'Procedures',
  precedent: 'Precedents',
};

export default function KnowledgeBase() {
  const { data, loading } = useApi(() => api.knowledge(), []);
  const [cat, setCat] = useState<KnowledgeCategory | 'all'>('all');

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of data ?? []) c[k.category] = (c[k.category] ?? 0) + 1;
    return c;
  }, [data]);

  const filtered = (data ?? []).filter((k) => cat === 'all' || k.category === cat);

  return (
    <div className="space-y-5">
      <header>
        <div className="label mb-1">RAG Corpus</div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Knowledge Base</h1>
        <p className="mt-1 text-sm text-muted">
          The fictional Aegis coverage handbook, exclusions, procedures, and prior-claim precedents — every chunk is
          embedded and retrievable. All content is synthetic.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-ink-850 p-1">
        <Tab active={cat === 'all'} onClick={() => setCat('all')} label={`All (${data?.length ?? 0})`} />
        {(Object.keys(CAT_LABEL) as KnowledgeCategory[]).map((c) => (
          <Tab key={c} active={cat === c} onClick={() => setCat(c)} label={`${CAT_LABEL[c]} (${counts[c] ?? 0})`} color={CAT_COLOR[c]} />
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((k, i) => (
            <motion.div key={k.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
              <Card className="card-pad h-full">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <BookOpen className="h-4 w-4" style={{ color: CAT_COLOR[k.category] }} />
                    {k.title}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-400">{k.text}</p>
                <div className="mt-3 flex items-center justify-between border-t border-line/50 pt-2 text-[11px] text-muted">
                  <span style={{ color: CAT_COLOR[k.category] }}>{CAT_LABEL[k.category]}</span>
                  <span className="font-mono">{k.source}</span>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', active ? 'bg-brand-500/20 text-white' : 'text-muted hover:text-slate-200')}
    >
      {color && <span className="h-2 w-2 rounded-sm" style={{ background: color }} />}
      {label}
    </button>
  );
}
