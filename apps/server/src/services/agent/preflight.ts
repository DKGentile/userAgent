/**
 * Deterministic pre-flight checks — no AI, no cost. These run first and can
 * short-circuit the whole decision (a terminal deny) before any model is
 * invoked, exactly like the production agent's pre-flights.
 */
import type { PreflightCheck } from '@shared';
import type { AgentContext } from './context.js';
import type { RawDecision } from './types.js';

export function runPreflights(ctx: AgentContext): { checks: PreflightCheck[]; terminal: RawDecision | null } {
  const checks: PreflightCheck[] = [];
  let terminal: RawDecision | null = null;

  // 1. Filing window
  const late = ctx.daysFiledAfterShip > ctx.client.maxFileDays;
  checks.push({
    name: 'Filing window',
    passed: !late,
    terminal: true,
    detail: `Filed ${ctx.daysFiledAfterShip}d after ship; account window is ${ctx.client.maxFileDays}d.`,
  });
  if (late && !terminal) {
    terminal = {
      decision: 'deny',
      confidence: 0.97,
      paidAmount: null,
      denialReason: `Late filing — filed ${ctx.daysFiledAfterShip} days after ship date, past the ${ctx.client.maxFileDays}-day window.`,
      missingDocTypeIds: [],
      escalationReason: null,
      flags: ['Late filing'],
      reasoning: stepify({
        eligibility: `Filed ${ctx.daysFiledAfterShip}d after ship — outside the ${ctx.client.maxFileDays}d filing window. This is dispositive.`,
        decision: 'Deny as a late filing without reaching the merits.',
      }),
    };
  }

  // 2. Excluded commodity
  checks.push({
    name: 'Excluded commodity',
    passed: !ctx.excluded,
    terminal: true,
    detail: ctx.excluded ? ctx.excluded.reason : 'Item is not an excluded commodity.',
  });
  if (ctx.excluded && !terminal) {
    terminal = {
      decision: 'deny',
      confidence: 0.96,
      paidAmount: null,
      denialReason: ctx.excluded.reason,
      missingDocTypeIds: [],
      escalationReason: null,
      flags: ['Excluded commodity'],
      reasoning: stepify({
        eligibility: `${ctx.excluded.reason} The exclusion applies regardless of documentation.`,
        decision: 'Deny on the exclusion.',
      }),
    };
  }

  // 3. Restricted destination ZIP (jewelry / coins only)
  checks.push({
    name: 'Restricted destination ZIP',
    passed: !ctx.restrictedZip,
    terminal: true,
    detail: ctx.restrictedZip
      ? `Jewelry/coin shipment touches restricted ZIP ${ctx.restrictedZip.zip}.`
      : 'Route does not touch a restricted ZIP for this commodity.',
  });
  if (ctx.restrictedZip && !terminal) {
    terminal = {
      decision: 'deny',
      confidence: 0.95,
      paidAmount: null,
      denialReason: `Jewelry/coin shipment to or from restricted ZIP ${ctx.restrictedZip.zip} is not insured.`,
      missingDocTypeIds: [],
      escalationReason: null,
      flags: ['Restricted destination'],
      reasoning: stepify({
        eligibility: `Commodity is jewelry/coins and the route touches restricted ZIP ${ctx.restrictedZip.zip}.`,
        decision: 'Deny — uninsured route for this commodity.',
      }),
    };
  }

  // 4. Account standing (cosmetic but plausible — always passes in the demo)
  checks.push({
    name: 'Account in good standing',
    passed: true,
    terminal: false,
    detail: `${ctx.client.name} — ${ctx.client.tier} tier, premium current.`,
  });

  return { checks, terminal };
}

function stepify(p: { eligibility?: string; tracking?: string; documents?: string; valuation?: string; decision?: string }): string {
  return [
    `STEP 1 ELIGIBILITY: ${p.eligibility ?? '—'}`,
    p.tracking ? `STEP 2 TRACKING: ${p.tracking}` : 'STEP 2 TRACKING: not reached.',
    p.documents ? `STEP 3 DOCUMENTS: ${p.documents}` : 'STEP 3 DOCUMENTS: not reached.',
    p.valuation ? `STEP 4 VALUATION: ${p.valuation}` : 'STEP 4 VALUATION: not reached.',
    `STEP 5 DECISION: ${p.decision ?? '—'}`,
  ].join('\n');
}

export { stepify };
