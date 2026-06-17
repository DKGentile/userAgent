/**
 * Guard rails applied after the reasoner produces a verdict — the same two
 * safety gates the production agent uses:
 *   - Reasoning↔decision consistency (catch a model that argues one way but
 *     emits the opposite tool call).
 *   - Confidence floor (commit only above threshold; otherwise escalate).
 */
import type { GateResult } from '@shared';
import { Config } from '../../config.js';
import type { AgentContext } from './context.js';
import type { RawDecision } from './types.js';

const APPROVE_SIGNALS = ['approve for $', 'should be approved', 'approving the claim', 'proceeding with approval'];
const DENY_SIGNALS = ['should be denied', 'deny the claim', 'declining the claim', 'proceeding with denial', 'should deny'];

export function runGates(raw: RawDecision, _ctx: AgentContext): { gates: GateResult[]; decision: RawDecision } {
  const gates: GateResult[] = [];
  const r = (raw.reasoning || '').toLowerCase();

  const contradiction =
    (raw.decision === 'deny' && APPROVE_SIGNALS.some((s) => r.includes(s))) ||
    (raw.decision === 'approve' && DENY_SIGNALS.some((s) => r.includes(s)));
  gates.push({
    name: 'Reasoning ↔ decision consistency',
    passed: !contradiction,
    note: contradiction
      ? 'Reasoning argues the opposite of the emitted decision — auto-escalating.'
      : 'Reasoning supports the emitted decision.',
  });

  const committal = raw.decision === 'approve' || raw.decision === 'deny' || raw.decision === 'request_docs';
  const lowConf = committal && raw.confidence < Config.AGENT_MIN_CONFIDENCE;
  const pctFloor = Math.round(Config.AGENT_MIN_CONFIDENCE * 100);
  gates.push({
    name: `Confidence ≥ ${pctFloor}%`,
    passed: !lowConf,
    note: lowConf
      ? `Confidence ${Math.round(raw.confidence * 100)}% is below the ${pctFloor}% commit threshold — escalating.`
      : `Confidence ${Math.round(raw.confidence * 100)}%${committal ? ' — clears the commit threshold.' : ' (escalation/hold).'}`,
  });

  if (contradiction || lowConf) {
    return {
      gates,
      decision: {
        ...raw,
        decision: 'escalate',
        paidAmount: null,
        escalationReason: contradiction
          ? 'Reasoning/decision contradiction detected by the consistency gate — auto-escalated for human review.'
          : `Confidence below the ${pctFloor}% threshold — auto-escalated for human review. (Original verdict: ${raw.decision}.)`,
      },
    };
  }
  return { gates, decision: raw };
}
