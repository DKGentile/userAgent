import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src -> repo root
export const REPO_ROOT = path.resolve(here, '../../..');
export const SERVER_ROOT = path.resolve(here, '..');
export const WEB_ROOT = path.resolve(REPO_ROOT, 'apps/web');
export const DATA_DIR = path.resolve(SERVER_ROOT, 'data');

// Load .env from the repo root (optional — the app runs fully without it).
loadEnv({ path: path.join(REPO_ROOT, '.env') });

function str(key: string, fallback = ''): string {
  return process.env[key]?.trim() || fallback;
}
function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

export const Config = {
  PORT: num('PORT', 8787),
  IS_PROD: str('NODE_ENV') === 'production',

  // LLM
  ANTHROPIC_API_KEY: str('ANTHROPIC_API_KEY'),
  AGENT_MODEL: str('AGENT_MODEL', 'claude-sonnet-4-6'),
  ANALYZER_MODEL: str('ANALYZER_MODEL', 'claude-haiku-4-5-20251001'),
  AGENT_THINKING_BUDGET: num('AGENT_THINKING_BUDGET', 1600),
  AGENT_MIN_CONFIDENCE: num('AGENT_MIN_CONFIDENCE', 0.8),

  // Embeddings
  OPENAI_API_KEY: str('OPENAI_API_KEY'),
  VOYAGE_API_KEY: str('VOYAGE_API_KEY'),

  // Database
  DB_PATH: str('DB_PATH', path.join(DATA_DIR, 'aegis.db')),
} as const;

export const hasLLM = () => Config.ANTHROPIC_API_KEY.length > 0;
