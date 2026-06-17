import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  Boxes,
  Brain,
  CheckCircle2,
  CircleDot,
  FileText,
  Gavel,
  MapPin,
  Play,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  AGENT_STAGE_LABELS,
  DOCUMENT_KIND_LABELS,
  type AgentEvent,
  type AgentStage,
  type ClaimDecision,
  type DocAnalysis,
  type GateResult,
  type PreflightCheck,
  type RagCitation,
  type TrackingStatus,
} from '@shared';
import { api, streamAgentRun, type ClaimDetail as ClaimDetailData } from '@/lib/api';
import { cn, pct, shortDate, usd } from '@/lib/cn';
import { Card, ConfidenceBar, DecisionBadge, Spinner, StatusBadge } from '@/components/ui';

const STAGES: AgentStage[] = ['context', 'preflight', 'documents', 'tracking', 'retrieval', 'reasoning', 'gates', 'decision'];
const STAGE_ICON: Record<AgentStage, typeof Brain> = {
  context: Boxes,
  preflight: ShieldCheck,
  documents: FileText,
  tracking: Truck,
  retrieval: BookOpen,
  reasoning: Brain,
  gates: ShieldCheck,
  decision: Gavel,
};

interface RunState {
  running: boolean;
  stages: Record<AgentStage, 'idle' | 'active' | 'done'>;
  preflights: PreflightCheck[];
  analyses: DocAnalysis[];
  tracking: TrackingStatus | null;
  citations: RagCitation[];
  query: string;
  thinking: string;
  answer: string;
  gates: GateResult[];
  decision: ClaimDecision | null;
  error: string | null;
}
const initialRun = (): RunState => ({
  running: false,
  stages: Object.fromEntries(STAGES.map((s) => [s, 'idle'])) as RunState['stages'],
  preflights: [],
  analyses: [],
  tracking: null,
  citations: [],
  query: '',
  thinking: '',
  answer: '',
  gates: [],
  decision: null,
  error: null,
});

export default function ClaimDetail() {
  const { id } = useParams();
  const claimId = Number(id);
  const [data, setData] = useState<ClaimDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<RunState>(initialRun);
  const abortRef = useRef<(() => void) | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.claim(claimId).then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [claimId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.();
  }, [load]);

  const start = () => {
    abortRef.current?.();
    setRun({ ...initialRun(), running: true });
    abortRef.current = streamAgentRun(
      claimId,
      (e: AgentEvent) => setRun((prev) => reduce(prev, e)),
      () => {
        setRun((p) => ({ ...p, running: false }));
        load();
      },
    );
  };

  if (loading || !data) {
    return <div className="flex h-[60vh] items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  }

  const { claim, documents, tracking } = data;
  const liveTracking = run.tracking ?? tracking;
  const shownDecision = run.decision ?? data.lastDecision;

  return (
    <div className="space-y-5">
      <Link to="/claims" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> Claims
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-xl font-bold text-white">{claim.publicRef}</h1>
            <StatusBadge status={claim.status} />
            <span className="chip border-line text-muted capitalize">{claim.type}</span>
          </div>
          <p className="mt-1 text-lg text-slate-200">{claim.itemDescription}</p>
          <p className="mt-0.5 text-sm text-muted">
            {claim.clientName} · <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: claim.carrierColor }} />{claim.carrierName}</span>
            {claim.isInternational && ' · international'}
          </p>
        </div>
        <button onClick={start} disabled={run.running} className="btn-primary">
          {run.running ? <><Spinner /> Running…</> : <><Play className="h-4 w-4" /> Run agent</>}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        {/* ---- Left: claim facts ---- */}
        <div className="space-y-4">
          <Card className="card-pad">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Valuation</h2>
            <dl className="space-y-2 text-sm">
              <Row k="Declared value" v={usd(claim.declaredValue)} />
              <Row k="Insured amount" v={usd(claim.insuredAmount)} />
              <Row k="Amount claimed" v={usd(claim.amountClaimed)} accent />
            </dl>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line/60 pt-3 text-xs text-muted">
              <div><div className="label">Ship date</div><div className="mt-0.5 text-slate-300">{shortDate(claim.shipDate)}</div></div>
              <div><div className="label">Filed</div><div className="mt-0.5 text-slate-300">{shortDate(claim.filedDate)}</div></div>
            </div>
          </Card>

          <Card className="card-pad">
            <h2 className="mb-2 text-sm font-semibold text-slate-300">Claimant narrative</h2>
            <p className="text-sm leading-relaxed text-slate-400">“{claim.narrative}”</p>
          </Card>

          <Card className="card-pad">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Documents <span className="text-muted">({documents.length})</span></h2>
            <div className="space-y-2">
              {documents.map((d) => {
                const a = run.analyses.find((x) => x.documentId === d.id);
                const amount = a?.amount ?? d.extractedAmount;
                const tracking = a?.tracking ?? d.extractedTracking;
                const analyzed = !!a || d.analyzed;
                return (
                  <div key={d.id} className="rounded-xl border border-line/70 bg-ink-800/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm text-slate-300"><FileText className="h-3.5 w-3.5 text-muted" />{DOCUMENT_KIND_LABELS[d.kind]}</span>
                      {analyzed && <span className="chip border-cyanide/30 bg-cyanide/10 text-cyanide">analyzed</span>}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted">{d.filename}</div>
                    {(amount || tracking) && (
                      <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                        {amount != null && <span className="chip border-approve/30 bg-approve/10 text-approve">${amount}</span>}
                        {tracking && <span className="chip border-line text-slate-400">{tracking}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="card-pad">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-300"><Truck className="h-4 w-4 text-muted" />Tracking</h2>
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="font-mono text-muted">{liveTracking.trackingNumber}</span>
              <TrackingStateChip state={liveTracking.state} />
            </div>
            <ol className="relative space-y-3 border-l border-line/70 pl-4">
              {liveTracking.events.map((ev, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand-500" />
                  <div className="text-xs text-slate-300">{ev.status}</div>
                  <div className="flex items-center gap-1 text-[11px] text-muted"><MapPin className="h-3 w-3" />{ev.location} · {shortDate(ev.timestamp)}</div>
                </li>
              ))}
              {liveTracking.events.length === 0 && <li className="text-xs text-muted">No carrier scans.</li>}
            </ol>
          </Card>

          {claim.groundTruthDecision && (
            <Card className="card-pad border-dashed">
              <div className="label mb-1">Adjudicator ground truth (eval label)</div>
              <div className="flex items-center gap-2"><DecisionBadge decision={claim.groundTruthDecision} /></div>
              {claim.groundTruthNote && <p className="mt-2 text-xs leading-relaxed text-muted">{claim.groundTruthNote}</p>}
            </Card>
          )}
        </div>

        {/* ---- Right: agent theater ---- */}
        <div className="space-y-4">
          <Card className="card-pad">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300"><Brain className="h-4 w-4 text-brand-400" />Agent pipeline</h2>
              {run.running && <span className="flex items-center gap-1.5 text-xs text-brand-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />live</span>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STAGES.map((s) => (
                <StageChip key={s} stage={s} state={run.stages[s]} />
              ))}
            </div>
          </Card>

          {(run.thinking || run.answer || run.running) && (
            <Card className="card-pad">
              <h2 className="mb-2 text-sm font-semibold text-slate-300">Reasoning stream</h2>
              {run.thinking && (
                <p className="mb-3 whitespace-pre-wrap rounded-lg border border-line/50 bg-ink-900/60 p-3 text-xs italic leading-relaxed text-muted">
                  {run.thinking}
                </p>
              )}
              <pre className={cn('whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-300', run.running && !run.decision && 'cursor-blink')}>
                {run.answer || (run.running ? '' : '')}
              </pre>
            </Card>
          )}

          {run.citations.length > 0 && (
            <Card className="card-pad">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-300"><BookOpen className="h-4 w-4 text-cyanide" />RAG retrieval</h2>
              <p className="mb-3 text-[11px] text-muted">Top knowledge-base matches injected into the prompt.</p>
              <div className="space-y-2">
                {run.citations.map((c) => (
                  <div key={c.chunkId} className="rounded-xl border border-line/70 bg-ink-800/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-200">{c.title}</span>
                      <span className="chip border-cyanide/30 bg-cyanide/10 font-mono text-cyanide">{pct(c.score, 0)}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">{c.source} · {c.category.replace('_', ' ')}</div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-400">{c.text}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {run.preflights.length > 0 && (
            <Card className="card-pad">
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Pre-flight checks <span className="text-muted">(deterministic)</span></h2>
              <div className="space-y-1.5">
                {run.preflights.map((c) => (
                  <CheckRow key={c.name} ok={c.passed} title={c.name} detail={c.detail} />
                ))}
              </div>
            </Card>
          )}

          {run.gates.length > 0 && (
            <Card className="card-pad">
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Guard rails</h2>
              <div className="space-y-1.5">
                {run.gates.map((g) => (
                  <CheckRow key={g.name} ok={g.passed} title={g.name} detail={g.note} />
                ))}
              </div>
            </Card>
          )}

          {run.error && (
            <Card className="card-pad border-deny/40">
              <p className="text-sm text-deny">{run.error}</p>
            </Card>
          )}

          <AnimatePresence>
            {shownDecision && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <DecisionCard d={shownDecision} live={!!run.decision} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function reduce(s: RunState, e: AgentEvent): RunState {
  switch (e.type) {
    case 'stage':
      return { ...s, stages: { ...s.stages, [e.stage]: e.phase === 'start' ? 'active' : 'done' } };
    case 'preflight':
      return { ...s, preflights: e.checks };
    case 'documents':
      return { ...s, analyses: e.analyses };
    case 'tracking':
      return { ...s, tracking: e.tracking };
    case 'retrieval':
      return { ...s, citations: e.citations, query: e.query };
    case 'thinking':
      return { ...s, thinking: s.thinking + e.text };
    case 'token':
      return { ...s, answer: s.answer + e.text };
    case 'gate':
      return { ...s, gates: [...s.gates, e.gate] };
    case 'decision':
      return { ...s, decision: e.decision };
    case 'error':
      return { ...s, error: e.message, running: false };
    case 'done':
      return { ...s, running: false };
    default:
      return s;
  }
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className={cn('font-mono', accent ? 'text-white' : 'text-slate-300')}>{v}</dd>
    </div>
  );
}

function StageChip({ stage, state }: { stage: AgentStage; state: 'idle' | 'active' | 'done' }) {
  const Icon = STAGE_ICON[stage];
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] font-medium transition-all',
        state === 'done' && 'border-approve/40 bg-approve/10 text-approve',
        state === 'active' && 'border-brand-500/50 bg-brand-500/15 text-white shadow-glow',
        state === 'idle' && 'border-line/60 bg-ink-800/40 text-muted',
      )}
    >
      {state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : state === 'active' ? <CircleDot className="h-3.5 w-3.5 animate-pulse" /> : <Icon className="h-3.5 w-3.5" />}
      <span className="truncate">{AGENT_STAGE_LABELS[stage]}</span>
    </div>
  );
}

function CheckRow({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-approve" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-deny" />}
      <div>
        <div className="text-sm text-slate-200">{title}</div>
        <div className="text-[11px] text-muted">{detail}</div>
      </div>
    </div>
  );
}

function TrackingStateChip({ state }: { state: TrackingStatus['state'] }) {
  const map: Record<string, string> = {
    delivered: 'border-approve/40 text-approve bg-approve/10',
    exception: 'border-deny/40 text-deny bg-deny/10',
    in_transit: 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10',
    out_for_delivery: 'border-brand-500/40 text-brand-400 bg-brand-500/10',
    returned: 'border-request/40 text-request bg-request/10',
    no_data: 'border-line text-muted',
  };
  return <span className={cn('chip capitalize', map[state] ?? map.no_data)}>{state.replace('_', ' ')}</span>;
}

const DECISION_TONE: Record<ClaimDecision['decision'], { wrap: string; head: string; icon: string }> = {
  approve: { wrap: 'border-approve/40', head: 'bg-approve/10', icon: 'text-approve' },
  deny: { wrap: 'border-deny/40', head: 'bg-deny/10', icon: 'text-deny' },
  request_docs: { wrap: 'border-request/40', head: 'bg-request/10', icon: 'text-request' },
  escalate: { wrap: 'border-escalate/40', head: 'bg-escalate/10', icon: 'text-escalate' },
};

function DecisionCard({ d, live }: { d: ClaimDecision; live: boolean }) {
  const tone = DECISION_TONE[d.decision];
  return (
    <div className={cn('card overflow-hidden', tone.wrap)}>
      <div className={cn('flex items-center justify-between px-5 py-4', tone.head)}>
        <div className="flex items-center gap-3">
          <Gavel className={cn('h-5 w-5', tone.icon)} />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted">{live ? 'Agent decision' : 'Latest decision'}</div>
            <DecisionBadge decision={d.decision} />
          </div>
        </div>
        {d.paidAmount != null && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-muted">Payout</div>
            <div className="font-mono text-xl font-semibold text-white">{usd(d.paidAmount)}</div>
          </div>
        )}
      </div>
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="label">Confidence</span>
          <ConfidenceBar value={d.confidence} />
        </div>
        {d.denialReason && <Field label="Denial reason" value={d.denialReason} />}
        {d.escalationReason && <Field label="Escalation reason" value={d.escalationReason} />}
        {d.flags.length > 0 && (
          <div>
            <div className="label mb-1">Flags</div>
            <div className="flex flex-wrap gap-1.5">
              {d.flags.map((f) => <span key={f} className="chip border-request/30 bg-request/10 text-request">{f}</span>)}
            </div>
          </div>
        )}
        <div>
          <div className="label mb-1">Reasoning</div>
          <pre className="whitespace-pre-wrap rounded-lg border border-line/50 bg-ink-900/60 p-3 font-mono text-[11px] leading-relaxed text-slate-300">{d.reasoning}</pre>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-3 text-[11px] text-muted">
          <span>model: <span className="font-mono text-slate-400">{d.model}</span></span>
          <span>{d.usedRealModel ? 'real LLM' : 'deterministic'}</span>
          {d.usedRealModel && <span>tokens: {d.inputTokens}→{d.outputTokens}</span>}
          <span>{d.tookMs} ms</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label mb-0.5">{label}</div>
      <p className="text-sm text-slate-300">{value}</p>
    </div>
  );
}
