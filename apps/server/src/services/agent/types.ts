import type { DecisionKind } from '@shared';

/** The raw verdict produced by the reasoner (LLM or simulator) or a terminal
 * pre-flight, before the engine wraps it into a full ClaimDecision. */
export interface RawDecision {
  decision: DecisionKind;
  confidence: number;
  paidAmount: number | null;
  denialReason: string | null;
  missingDocTypeIds: number[];
  escalationReason: string | null;
  reasoning: string;
  flags: string[];
}
