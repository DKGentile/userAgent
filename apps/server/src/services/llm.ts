/**
 * LLM access. Returns a real Anthropic client when ANTHROPIC_API_KEY is set;
 * otherwise the rest of the system falls back to the deterministic reasoner.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Config, hasLLM } from '../config.js';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  if (!hasLLM()) return null;
  if (!_client) _client = new Anthropic({ apiKey: Config.ANTHROPIC_API_KEY, maxRetries: 2 });
  return _client;
}

export function llmInfo(): { provider: 'anthropic' | 'simulator'; model: string } {
  return hasLLM()
    ? { provider: 'anthropic', model: Config.AGENT_MODEL }
    : { provider: 'simulator', model: 'aegis-deterministic-v1' };
}
