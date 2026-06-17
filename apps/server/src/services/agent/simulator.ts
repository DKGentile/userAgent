/**
 * Deterministic reasoner — the "brain" used when no LLM key is configured (and
 * the reference logic the real Claude prompt is modeled on). It applies the
 * Aegis adjudication rules in priority order and emits structured STEP 1–5
 * reasoning that references the retrieved knowledge, so the demo behaves
 * realistically with zero external dependencies.
 */
import type { RagCitation } from '@shared';
import type { AgentContext } from './context.js';
import type { RawDecision } from './types.js';
import { stepify } from './preflight.js';

const HIGH_VALUE_THRESHOLD = 8000;

function cite(citations: RagCitation[], idx = 0): string {
  const c = citations[idx];
  return c ? ` (cf. ${c.title} — ${c.source})` : '';
}

function payout(ctx: AgentContext): number {
  const { claim, client } = ctx;
  const base =
    claim.type === 'shortage'
      ? Math.min(claim.amountClaimed, claim.insuredAmount)
      : Math.min(claim.amountClaimed, claim.insuredAmount, ctx.invoiceAmount ?? claim.amountClaimed);
  return Math.max(0, Math.round((base - client.deductible) * 100) / 100);
}

function trackingLine(ctx: AgentContext): string {
  const t = ctx.tracking;
  const since = t.daysSinceLastScan == null ? 'unknown' : `${t.daysSinceLastScan}d ago`;
  return `state=${t.state}, last scan ${since}` + (ctx.signatureOnDelivery ? ', delivered WITH signature' : '');
}

export function simulateDecision(ctx: AgentContext, citations: RagCitation[]): RawDecision {
  const { claim, carrier } = ctx;
  const docsLine = `required=[${ctx.requiredDocTypeIds.join(', ')}], missing=[${ctx.missingDocLabels.join(', ') || 'none'}]`;

  // 1. Tracking / invoice integrity — possible mismatched invoice
  if (ctx.trackingMismatch) {
    return {
      decision: 'escalate',
      confidence: 0.55,
      paidAmount: null,
      denialReason: null,
      missingDocTypeIds: [],
      escalationReason: `Invoice tracking (${ctx.trackingMismatch.docTracking}) does not tie to the claim tracking number. Possible mismatched or borrowed invoice — needs human review.`,
      flags: ['Tracking/invoice mismatch'],
      reasoning: stepify({
        eligibility: 'No disqualifying exclusion or late filing.',
        tracking: trackingLine(ctx),
        documents: `${docsLine}. Invoice tracking does not reconcile with the claim${cite(citations)}.`,
        decision: 'Escalate — cannot trust the documentation tie-out without a human.',
      }),
    };
  }

  // 2. High documented value -> mandatory human sign-off
  if (claim.amountClaimed >= HIGH_VALUE_THRESHOLD) {
    return {
      decision: 'escalate',
      confidence: 0.6,
      paidAmount: null,
      denialReason: null,
      missingDocTypeIds: [],
      escalationReason: `Documented value $${claim.amountClaimed.toLocaleString()} exceeds the $${HIGH_VALUE_THRESHOLD.toLocaleString()} auto-decision ceiling${claim.isInternational ? ' on an international lane' : ''}.`,
      flags: ['High-value claim', ...(claim.isInternational ? ['International lane'] : [])],
      reasoning: stepify({
        eligibility: 'Eligible; no exclusion or late filing.',
        tracking: trackingLine(ctx),
        documents: docsLine,
        valuation: `Would pay ~$${payout(ctx).toLocaleString()} on the merits, but value is material.`,
        decision: `Escalate for human sign-off on a large payout${cite(citations)}.`,
      }),
    };
  }

  // 3. Loss claims vs the delivery scan
  if (claim.type === 'loss' && ctx.tracking.state === 'delivered') {
    if (ctx.signatureOnDelivery) {
      return {
        decision: 'deny',
        confidence: 0.9,
        paidAmount: null,
        denialReason: 'Carrier shows delivery captured with a signature — strong evidence of receipt.',
        missingDocTypeIds: [],
        escalationReason: null,
        flags: ['Delivered with signature'],
        reasoning: stepify({
          eligibility: 'Eligible.',
          tracking: `${trackingLine(ctx)}. A signed delivery scan contradicts the non-receipt claim${cite(citations)}.`,
          documents: docsLine,
          decision: 'Deny — signed delivery defeats the loss claim.',
        }),
      };
    }
    if (ctx.presentKinds.has('affidavit')) {
      return {
        decision: 'escalate',
        confidence: 0.58,
        paidAmount: null,
        denialReason: null,
        missingDocTypeIds: [],
        escalationReason: 'Delivered without a signature; consignee affidavit on file. Porch theft is plausible but not certain.',
        flags: ['Delivered, no signature', 'Possible porch theft'],
        reasoning: stepify({
          eligibility: 'Eligible.',
          tracking: `${trackingLine(ctx)}. Unsigned delivery + affidavit is the classic porch-theft pattern${cite(citations)}.`,
          documents: docsLine,
          decision: 'Escalate for a human judgment call on porch theft.',
        }),
      };
    }
    return requestDocs(ctx, citations, docsLine);
  }

  // 4. Loss filed before the parcel is presumed lost (premature) or no data
  if (claim.type === 'loss' && (ctx.tracking.state === 'in_transit' || ctx.tracking.state === 'out_for_delivery' || ctx.tracking.state === 'no_data')) {
    const since = ctx.tracking.daysSinceLastScan;
    const premature = since == null || since < carrier.presumedLostDays;
    if (premature) {
      return {
        decision: 'escalate',
        confidence: ctx.tracking.state === 'no_data' ? 0.6 : 0.65,
        paidAmount: null,
        denialReason: null,
        missingDocTypeIds: [],
        escalationReason:
          ctx.tracking.state === 'no_data'
            ? 'No carrier tracking data available to confirm or refute the loss.'
            : `Parcel last scanned ${since}d ago, inside ${carrier.name}'s ${carrier.presumedLostDays}-day presumed-lost window. Premature to pay or deny.`,
        flags: ['Premature filing'],
        reasoning: stepify({
          eligibility: 'Eligible.',
          tracking: `${trackingLine(ctx)}. Window is ${carrier.presumedLostDays}d for ${carrier.name}${cite(citations)}.`,
          documents: docsLine,
          decision: 'Escalate / hold — the loss is not yet established.',
        }),
      };
    }
  }

  // 5. Missing required documents
  if (ctx.missingDocTypeIds.length > 0) {
    return requestDocs(ctx, citations, docsLine);
  }

  // 6. Approve
  const paid = payout(ctx);
  return {
    decision: 'approve',
    confidence: ctx.invoiceAmount ? 0.92 : 0.88,
    paidAmount: paid,
    denialReason: null,
    missingDocTypeIds: [],
    escalationReason: null,
    flags: [],
    reasoning: stepify({
      eligibility: 'Eligible — no exclusion, no late filing.',
      tracking: trackingLine(ctx),
      documents: `${docsLine}. All required documentation present.`,
      valuation: `Pay min(claimed $${claim.amountClaimed.toLocaleString()}, insured $${claim.insuredAmount.toLocaleString()}${ctx.invoiceAmount ? `, invoice $${ctx.invoiceAmount.toLocaleString()}` : ''}) − $${ctx.client.deductible} deductible = $${paid.toLocaleString()}.`,
      decision: `Approve for $${paid.toLocaleString()}${cite(citations)}.`,
    }),
  };
}

function requestDocs(ctx: AgentContext, citations: RagCitation[], docsLine: string): RawDecision {
  return {
    decision: 'request_docs',
    confidence: 0.85,
    paidAmount: null,
    denialReason: null,
    missingDocTypeIds: ctx.missingDocTypeIds,
    escalationReason: null,
    flags: [],
    reasoning: stepify({
      eligibility: 'Eligible; no exclusion or late filing.',
      tracking: trackingLine(ctx),
      documents: `${docsLine}. Cannot adjudicate without: ${ctx.missingDocLabels.join(', ')}${cite(citations)}.`,
      decision: `Request the missing document(s); never deny for missing paperwork.`,
    }),
  };
}
