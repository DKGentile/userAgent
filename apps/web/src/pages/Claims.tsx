import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { CLAIM_STATUS_LABELS, type ClaimStatus, type ClaimType } from '@shared';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { cn, shortDate, usd } from '@/lib/cn';
import { Card, Empty, Spinner, StatusBadge } from '@/components/ui';

const STATUSES: (ClaimStatus | 'all')[] = ['all', 'new', 'in_review', 'awaiting_docs', 'approved', 'denied', 'escalated'];
const TYPES: (ClaimType | 'all')[] = ['all', 'loss', 'damage', 'shortage'];

export default function Claims() {
  const [status, setStatus] = useState<ClaimStatus | 'all'>('all');
  const [type, setType] = useState<ClaimType | 'all'>('all');
  const [q, setQ] = useState('');

  const { data, loading } = useApi(
    () => api.claims({ status: status === 'all' ? undefined : status, type: type === 'all' ? undefined : type }),
    [status, type],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(
      (c) =>
        c.itemDescription.toLowerCase().includes(needle) ||
        c.publicRef.toLowerCase().includes(needle) ||
        c.clientName.toLowerCase().includes(needle),
    );
  }, [data, q]);

  return (
    <div className="space-y-5">
      <header>
        <div className="label mb-1">Work Queue</div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Claims</h1>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search item, reference, or client…"
            className="w-full rounded-xl border border-line bg-ink-850 py-2.5 pl-10 pr-3 text-sm text-slate-200 outline-none placeholder:text-muted focus:border-brand-500/60"
          />
        </div>
        <Segmented options={STATUSES.map((s) => ({ value: s, label: s === 'all' ? 'All' : CLAIM_STATUS_LABELS[s] }))} value={status} onChange={(v) => setStatus(v as ClaimStatus | 'all')} />
        <Segmented options={TYPES.map((t) => ({ value: t, label: t === 'all' ? 'All types' : t }))} value={type} onChange={(v) => setType(v as ClaimType | 'all')} />
      </div>

      <Card>
        <div className="grid grid-cols-[1.1fr_2fr_1fr_0.9fr_0.9fr] items-center gap-4 border-b border-line/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <span>Reference</span>
          <span>Item</span>
          <span>Client / Carrier</span>
          <span className="text-right">Claimed</span>
          <span className="text-right">Status</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        ) : filtered.length === 0 ? (
          <Empty>No claims match these filters.</Empty>
        ) : (
          <div className="divide-y divide-line/50">
            {filtered.map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}>
                <Link
                  to={`/claims/${c.id}`}
                  className="grid grid-cols-[1.1fr_2fr_1fr_0.9fr_0.9fr] items-center gap-4 px-5 py-3.5 transition-colors hover:bg-ink-800/50"
                >
                  <div>
                    <div className="font-mono text-sm text-slate-200">{c.publicRef}</div>
                    <div className="mt-0.5 text-[11px] capitalize text-muted">{c.type} · filed {shortDate(c.filedDate)}</div>
                  </div>
                  <div className="truncate text-sm text-slate-300">{c.itemDescription}</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-300">{c.clientName}</div>
                    <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: c.carrierColor }} />
                      {c.carrierName}
                    </span>
                  </div>
                  <div className="text-right font-mono text-sm text-slate-200">{usd(c.amountClaimed)}</div>
                  <div className="flex justify-end">
                    <StatusBadge status={c.status} />
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-ink-850 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize transition-colors',
            value === o.value ? 'bg-brand-500/20 text-white' : 'text-muted hover:text-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
