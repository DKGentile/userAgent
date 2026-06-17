/**
 * Real Claude decision path: streaming tool-use with extended thinking. Streams
 * thinking + answer deltas out through `emit` so the UI can render the agent
 * "thinking" live, then parses the submit_claim_decision tool call. Returns
 * null on any failure so the engine can fall back to the deterministic reasoner.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, RagCitation } from '@shared';
import { Config } from '../../config.js';
import { getAnthropic } from '../llm.js';
import { buildSystem, buildUserPrompt, DECISION_TOOL } from './prompts.js';
import type { AgentContext } from './context.js';
import type { RawDecision } from './types.js';

export interface LlmResult {
  raw: RawDecision;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaudeDecision(
  ctx: AgentContext,
  citations: RagCitation[],
  emit: (e: AgentEvent) => void,
): Promise<LlmResult | null> {
  const client = getAnthropic();
  if (!client) return null;

  try {
    const budget = Config.AGENT_THINKING_BUDGET;
    const params: Anthropic.MessageStreamParams = {
      model: Config.AGENT_MODEL,
      max_tokens: 4096 + Math.max(0, budget),
      system: buildSystem(ctx, citations, Config.AGENT_MIN_CONFIDENCE),
      tools: [DECISION_TOOL],
      tool_choice: { type: 'auto' }, // extended thinking requires auto, not forced
      messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
      ...(budget > 0 ? { thinking: { type: 'enabled', budget_tokens: budget } } : {}),
    };

    const stream = client.messages.stream(params);
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') emit({ type: 'thinking', text: event.delta.thinking });
        else if (event.delta.type === 'text_delta' && event.delta.text) emit({ type: 'token', text: event.delta.text });
      }
    });

    const final = await stream.finalMessage();
    const tool = final.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!tool) return null;
    const input = tool.input as {
      decision: RawDecision['decision'];
      confidence?: number;
      paid_amount?: number | null;
      denial_reason?: string | null;
      missing_document_ids?: number[];
      escalation_reason?: string | null;
      reasoning?: string;
      flags?: string[];
    };

    const raw: RawDecision = {
      decision: input.decision,
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      paidAmount: input.decision === 'approve' ? input.paid_amount ?? null : null,
      denialReason: input.denial_reason ?? null,
      missingDocTypeIds: input.missing_document_ids ?? [],
      escalationReason: input.escalation_reason ?? null,
      reasoning: input.reasoning ?? '(model returned no reasoning)',
      flags: input.flags ?? [],
    };
    return {
      raw,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
    };
  } catch {
    return null;
  }
}
