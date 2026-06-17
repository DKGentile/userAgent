/**
 * Prompt construction for the real Claude decision path. The system prompt is
 * split into a cache-stable framework block (identical across claims in a run,
 * so prompt caching gives a large input discount) and a dynamic block carrying
 * the RAG citations + this client's SOP parameters.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { RagCitation } from '@shared';
import type { AgentContext } from './context.js';

export const DECISION_TOOL: Anthropic.Tool = {
  name: 'submit_claim_decision',
  description: 'Submit the final, structured decision for this insurance claim. You MUST call this tool.',
  input_schema: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['approve', 'deny', 'request_docs', 'escalate'],
        description:
          'approve = pay the claim; deny = decline it; request_docs = required documents are missing; escalate = cannot confidently decide / needs a human.',
      },
      confidence: { type: 'number', description: 'Confidence in the decision, 0.0–1.0.' },
      paid_amount: {
        type: ['number', 'null'],
        description:
          'If approving: min(invoice value, insured amount) for loss/damage, or the value of the missing items for a shortage, MINUS the account deductible. Otherwise null.',
      },
      denial_reason: { type: ['string', 'null'], description: 'If denying, a concise internal reason.' },
      missing_document_ids: {
        type: 'array',
        items: { type: 'integer' },
        description: 'If requesting docs, the doc-type IDs needed: 1=Invoice, 2=Damage photos, 3=Consignee affidavit, 5=Packing slip.',
      },
      escalation_reason: { type: ['string', 'null'], description: 'If escalating, why a human must review.' },
      reasoning: {
        type: 'string',
        description:
          'Findings as: STEP 1 ELIGIBILITY / STEP 2 TRACKING / STEP 3 DOCUMENTS / STEP 4 VALUATION / STEP 5 DECISION. Each finding is final; do not revise earlier steps.',
      },
      flags: { type: 'array', items: { type: 'string' }, description: 'Red flags or concerns.' },
    },
    required: ['decision', 'confidence', 'reasoning'],
  },
};

const FRAMEWORK = `You are Aegis, an autonomous claims adjudicator for a shipping-insurance carrier. You decide whether to APPROVE, DENY, REQUEST DOCUMENTS, or ESCALATE a claim, and you always justify the call.

Decision framework — evaluate in order and stop at the first dispositive step:
STEP 1 ELIGIBILITY  — Is the item an excluded commodity (loose gemstones, currency at face value, perishables)? Was the claim filed within the account's filing window? An exclusion or a late filing is dispositive — deny. NEVER deny merely for an *early* filing.
STEP 2 TRACKING     — Does carrier tracking support or contradict the claim? A signed delivery defeats a loss claim. A parcel still inside the carrier's presumed-lost window is a premature loss — escalate, do not pay or deny. An invoice whose tracking does not tie to the claim is a red flag — escalate.
STEP 3 DOCUMENTS    — Loss needs invoice + consignee affidavit; damage needs invoice + photos; shortage needs invoice + photos or packing slip. Missing required docs => request_docs, never a denial.
STEP 4 VALUATION    — Pay min(invoice value, insured amount) for loss/damage (the value of missing items for a shortage), minus the deductible. Exclude fees.
STEP 5 DECISION     — State which step decided it. High documented value (>= $8,000) requires human sign-off: escalate.

Call submit_claim_decision with your structured decision. Do not answer in plain prose.`;

export function buildSystem(
  ctx: AgentContext,
  citations: RagCitation[],
  minConfidence: number,
): Anthropic.TextBlockParam[] {
  const knowledge = citations
    .map((c, i) => `[${i + 1}] (${c.category}) ${c.title} — ${c.source}\n${c.text}`)
    .join('\n\n');
  const dynamic = `RETRIEVED KNOWLEDGE (top matches from the Aegis knowledge base for this claim):\n\n${knowledge}\n\nCLIENT SOP — ${ctx.client.name} (${ctx.client.tier} tier):\n- Filing window: ${ctx.client.maxFileDays} days\n- Waiting period (this lane): ${ctx.waitingDays} days\n- Deductible: $${ctx.client.deductible}\n${ctx.client.handlingNote ? `- Handling note: ${ctx.client.handlingNote}\n` : ''}\nMinimum confidence to commit to approve/deny/request_docs is ${(minConfidence * 100).toFixed(0)}%. Below that, escalate.`;
  return [
    { type: 'text' as const, text: FRAMEWORK, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: dynamic },
  ];
}

export function buildUserPrompt(ctx: AgentContext): string {
  const { claim, tracking } = ctx;
  const docs = ctx.analyses
    .map((a) => `- ${a.detectedDocType}: ${a.filename}${a.amount ? ` ($${a.amount})` : ''}${a.tracking ? ` [${a.tracking}]` : ''}`)
    .join('\n');
  const events = tracking.events
    .slice(-4)
    .map((e) => `  ${e.timestamp.slice(0, 10)} — ${e.status} (${e.location})`)
    .join('\n');
  return `CLAIM ${claim.publicRef} (${claim.type})
Item: ${claim.itemDescription}
Narrative: ${claim.narrative}
Client: ${claim.clientName} | Carrier: ${claim.carrierName}
Declared value: $${claim.declaredValue} | Insured: $${claim.insuredAmount} | Claimed: $${claim.amountClaimed}
Deductible: $${ctx.client.deductible}
Ship date: ${claim.shipDate} | Filed: ${claim.filedDate} (${ctx.daysFiledAfterShip}d after ship; window ${ctx.client.maxFileDays}d)
International: ${claim.isInternational ? 'yes' : 'no'}

TRACKING (${claim.trackingNumber}): state=${tracking.state}, last scan ${tracking.daysSinceLastScan ?? '?'}d ago. Presumed-lost window for ${ctx.carrier.name}: ${ctx.carrier.presumedLostDays}d.
${events || '  (no scans)'}

DOCUMENTS (analyzed):
${docs || '  (none)'}
Missing required documents: ${ctx.missingDocLabels.join(', ') || 'none'}

Adjudicate this claim. Call submit_claim_decision.`;
}
