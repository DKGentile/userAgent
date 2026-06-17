import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Boxes,
  Database,
  Cpu,
  LayoutDashboard,
  ListChecks,
  Radar,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import type { SystemCapabilities } from '@shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import Dashboard from '@/pages/Dashboard';
import Claims from '@/pages/Claims';
import ClaimDetail from '@/pages/ClaimDetail';
import SemanticSearch from '@/pages/SemanticSearch';
import KnowledgeBase from '@/pages/KnowledgeBase';
import Backtest from '@/pages/Backtest';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/claims', label: 'Claims Queue', icon: ListChecks },
  { to: '/search', label: 'Semantic Search', icon: ScanSearch },
  { to: '/knowledge', label: 'Knowledge Base', icon: Boxes },
  { to: '/backtest', label: 'Backtest', icon: Radar },
];

function Sidebar({ caps }: { caps: SystemCapabilities | null }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line/70 bg-ink-900/60 backdrop-blur">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-cyanide shadow-glow">
          <Sparkles className="h-5 w-5 text-ink-950" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-white">Aegis</div>
          <div className="text-[11px] text-muted">Claims Intelligence</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-500/15 text-white shadow-[inset_0_0_0_1px_rgba(99,102,241,0.35)]'
                  : 'text-slate-400 hover:bg-ink-800/70 hover:text-slate-200',
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-line/70 px-4 py-4 text-[11px]">
        <ProvenanceRow icon={Cpu} label="Agent" value={caps ? `${caps.llm.provider} · ${caps.llm.model.replace('claude-', '')}` : '…'} live={caps?.llm.provider === 'anthropic'} />
        <ProvenanceRow icon={Sparkles} label="Embeddings" value={caps ? `${caps.embeddings.provider} · ${caps.embeddings.dims}d` : '…'} live={!!caps && caps.embeddings.provider !== 'feature-hash'} />
        <ProvenanceRow icon={Database} label="Database" value={caps ? caps.database.driver : '…'} live />
      </div>
    </aside>
  );
}

function ProvenanceRow({
  icon: Icon,
  label,
  value,
  live,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  live?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="flex items-center gap-1.5 font-mono text-slate-300">
        <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-approve' : 'bg-slate-500')} />
        {value}
      </span>
    </div>
  );
}

export default function App() {
  const [caps, setCaps] = useState<SystemCapabilities | null>(null);
  const location = useLocation();

  useEffect(() => {
    api.capabilities().then(setCaps).catch(() => {});
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar caps={caps} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-8 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname.split('/').slice(0, 2).join('/')}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              <Routes location={location}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/claims" element={<Claims />} />
                <Route path="/claims/:id" element={<ClaimDetail />} />
                <Route path="/search" element={<SemanticSearch />} />
                <Route path="/knowledge" element={<KnowledgeBase />} />
                <Route path="/backtest" element={<Backtest />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
