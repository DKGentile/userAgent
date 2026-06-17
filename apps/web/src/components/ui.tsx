import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ClaimStatus, DecisionKind } from '@shared';
import { CLAIM_STATUS_LABELS, DECISION_LABELS } from '@shared';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card', className)}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">{children}</h2>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

const STATUS_STYLES: Record<ClaimStatus, string> = {
  new: 'border-slate-600 text-slate-300 bg-slate-500/10',
  in_review: 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10',
  awaiting_docs: 'border-request/40 text-request bg-request/10',
  pending_signoff: 'border-brand-500/40 text-brand-400 bg-brand-500/10',
  approved: 'border-approve/40 text-approve bg-approve/10',
  denied: 'border-deny/40 text-deny bg-deny/10',
  escalated: 'border-escalate/40 text-escalate bg-escalate/10',
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return <span className={cn('chip', STATUS_STYLES[status])}>{CLAIM_STATUS_LABELS[status]}</span>;
}

const DECISION_STYLES: Record<DecisionKind, string> = {
  approve: 'border-approve/40 text-approve bg-approve/10',
  deny: 'border-deny/40 text-deny bg-deny/10',
  request_docs: 'border-request/40 text-request bg-request/10',
  escalate: 'border-escalate/40 text-escalate bg-escalate/10',
};

export function DecisionBadge({ decision }: { decision: DecisionKind }) {
  return (
    <span className={cn('chip font-semibold', DECISION_STYLES[decision])}>
      {DECISION_LABELS[decision]}
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 0.85 ? 'bg-approve' : value >= 0.7 ? 'bg-request' : 'bg-deny';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-700">
        <motion.div
          className={cn('h-full rounded-full', color)}
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(value * 100)}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-slate-400">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-4 w-4 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-400',
        className,
      )}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'good' }) {
  const tones = {
    neutral: 'border-line text-slate-400 bg-ink-800/60',
    brand: 'border-brand-500/40 text-brand-400 bg-brand-500/10',
    good: 'border-approve/40 text-approve bg-approve/10',
  } as const;
  return <span className={cn('chip', tones[tone])}>{children}</span>;
}
