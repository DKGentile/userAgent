/**
 * The agent engine. Orchestrates the full pipeline for one claim and streams
 * structured AgentEvents as it goes:
 *   context → preflight → documents → tracking → retrieval → reasoning → gates → decision
 *
 * Used two ways:
 *   - runAgent(claimId, emit)      live, streaming, persists the decision
 *   - decideClaim(claimId)         headless (backtest); collects, does not persist
 */
import type { AgentEvent, ClaimDecision, ClaimStatus, DecisionKind } from '@shared';
import { analyzeClaimDocuments } from '../documentAnalyzer.js';
import { claimQueryText, retrieve } from '../rag.js';
import { llmInfo } from '../llm.js';
import {
  getLastDecision,
  insertChange,
  insertDecision,
  updateClaimStatus,
} from '../../db/repos.js';
import { applyAnalyses, assembleBaseContext } from './context.js';
import { runPreflights } from './preflight.js';
import { simulateDecision } from './simulator.js';
import { callClaudeDecision } from './llmDecision.js';
import { runGates } from './gates.js';
import type { RawDecision } from './types.js';

type Emit = (e: AgentEvent) => void;
const NOOP: Emit = () => {};

interface RunOpts {
  persist?: boolean;
  stream?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusFor(decision: DecisionKind): ClaimStatus {
  switch (decision) {
    case 'approve':
      return 'approved';
    case 'deny':
      return 'denied';
    case 'request_docs':
      return 'awaiting_docs';
    default:
      return 'escalated';
  }
}

async function streamReasoning(emit: Emit, text: string, stream: boolean): Promise<void> {
  if (!stream) return;
  emit({ type: 'thinking', text: 'Working through the adjudication framework, step by step…\n' });
  await sleep(120);
  const tokens = text.split(/(\s+)/);
  for (const tok of tokens) {
    emit({ type: 'token', text: tok });
    if (tok.trim()) await sleep(11);
  }
}

export async function runAgent(claimId: number, emit: Emit = NOOP, opts: RunOpts = {}): Promise<ClaimDecision> {
  const persist = opts.persist ?? true;
  const stream = opts.stream ?? true;
  const t0 = performance.now();
  const maybe = (ms: number) => (stream ? sleep(ms) : Promise.resolve());

  // --- context ---
  emit({ type: 'stage', stage: 'context', phase: 'start' });
  const ctx = assembleBaseContext(claimId);
  if (!ctx) throw new Error(`Claim ${claimId} not found`);
  const priorStatus = ctx.claim.status;
  await maybe(180);
  emit({
    type: 'stage',
    stage: 'context',
    phase: 'done',
    detail: `${ctx.claim.publicRef} · ${ctx.claim.type} · ${ctx.claim.clientName} via ${ctx.claim.carrierName}`,
  });

  // --- preflight ---
  emit({ type: 'stage', stage: 'preflight', phase: 'start' });
  const { checks, terminal } = runPreflights(ctx);
  emit({ type: 'preflight', checks });
  await maybe(120);
  emit({ type: 'stage', stage: 'preflight', phase: 'done' });

  let raw: RawDecision;
  let citations: ClaimDecision['citations'] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let usedRealModel = false;
  let model = 'aegis-deterministic-v1';

  if (terminal) {
    // Short-circuit: a deterministic pre-flight already decided this. No model,
    // no document fetch, no retrieval — exactly like the production fast-path.
    emit({ type: 'stage', stage: 'reasoning', phase: 'start', detail: 'Pre-flight short-circuit (no model needed)' });
    await streamReasoning(emit, terminal.reasoning, stream);
    emit({ type: 'stage', stage: 'reasoning', phase: 'done' });
    raw = terminal;
    model = 'preflight';
  } else {
    // --- documents ---
    emit({ type: 'stage', stage: 'documents', phase: 'start' });
    const analyses = await analyzeClaimDocuments(claimId, persist);
    applyAnalyses(ctx, analyses);
    emit({ type: 'documents', analyses });
    await maybe(140);
    emit({ type: 'stage', stage: 'documents', phase: 'done', detail: `${analyses.length} document(s) analyzed` });

    // --- tracking ---
    emit({ type: 'stage', stage: 'tracking', phase: 'start' });
    emit({ type: 'tracking', tracking: ctx.tracking });
    await maybe(110);
    emit({ type: 'stage', stage: 'tracking', phase: 'done', detail: ctx.tracking.state });

    // --- retrieval (RAG) ---
    emit({ type: 'stage', stage: 'retrieval', phase: 'start' });
    const query = claimQueryText({
      type: ctx.claim.type,
      item: ctx.claim.itemDescription,
      narrative: ctx.claim.narrative,
      isInternational: ctx.claim.isInternational,
      trackingState: ctx.tracking.state,
    });
    citations = await retrieve(query, 5);
    emit({ type: 'retrieval', query, citations });
    await maybe(130);
    emit({ type: 'stage', stage: 'retrieval', phase: 'done', detail: `${citations.length} chunks` });

    // --- reasoning ---
    const info = llmInfo();
    model = info.model;
    emit({ type: 'stage', stage: 'reasoning', phase: 'start', detail: info.provider === 'anthropic' ? `${info.model} (tool use + extended thinking)` : 'deterministic reasoner' });
    const llm = await callClaudeDecision(ctx, citations, emit);
    if (llm) {
      raw = llm.raw;
      inputTokens = llm.inputTokens;
      outputTokens = llm.outputTokens;
      usedRealModel = true;
    } else {
      raw = simulateDecision(ctx, citations);
      model = 'aegis-deterministic-v1';
      await streamReasoning(emit, raw.reasoning, stream);
    }
    emit({ type: 'stage', stage: 'reasoning', phase: 'done' });
  }

  // --- gates ---
  emit({ type: 'stage', stage: 'gates', phase: 'start' });
  const { gates, decision: gated } = runGates(raw, ctx);
  for (const g of gates) {
    emit({ type: 'gate', gate: g });
    await maybe(70);
  }
  emit({ type: 'stage', stage: 'gates', phase: 'done' });

  // --- finalize ---
  const resultingStatus = statusFor(gated.decision);
  const decision: ClaimDecision = {
    claimId,
    decision: gated.decision,
    resultingStatus,
    confidence: gated.confidence,
    paidAmount: gated.paidAmount,
    denialReason: gated.denialReason,
    missingDocTypeIds: gated.missingDocTypeIds,
    escalationReason: gated.escalationReason,
    reasoning: gated.reasoning,
    flags: gated.flags,
    citations,
    preflights: checks,
    gates,
    model,
    usedRealModel,
    inputTokens,
    outputTokens,
    tookMs: Math.round(performance.now() - t0),
    decidedAt: new Date().toISOString(),
  };

  if (persist) {
    insertDecision(decision);
    insertChange(claimId, priorStatus, resultingStatus, `Agent ${gated.decision} (confidence ${Math.round(gated.confidence * 100)}%)`);
    updateClaimStatus(claimId, resultingStatus);
  }

  emit({ type: 'stage', stage: 'decision', phase: 'done', detail: gated.decision });
  emit({ type: 'decision', decision });
  emit({ type: 'done' });
  return decision;
}

/** Headless decision (no streaming, no persistence) — used by the backtest. */
export async function decideClaim(claimId: number): Promise<ClaimDecision> {
  return runAgent(claimId, NOOP, { persist: false, stream: false });
}

export function lastDecisionFor(claimId: number): ClaimDecision | null {
  return getLastDecision(claimId);
}
