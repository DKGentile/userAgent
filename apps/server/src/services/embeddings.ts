/**
 * Embeddings — a pluggable provider chosen automatically at boot:
 *   1. OPENAI_API_KEY  -> text-embedding-3-small (1536-dim)
 *   2. VOYAGE_API_KEY  -> voyage-3 (1024-dim)
 *   3. (neither)       -> built-in feature-hashing provider (384-dim, offline)
 *
 * The default provider is a real vector embedding (the "hashing trick" with
 * domain-aware synonym expansion + IDF-ish term weighting), so semantic search
 * works with zero dependencies and no network. Drop in a key for production-
 * grade embeddings without touching anything else.
 */
import { Config } from '../config.js';

export interface EmbeddingProvider {
  readonly name: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Feature-hashing provider (default, dependency-free)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were',
  'be', 'been', 'with', 'at', 'by', 'it', 'this', 'that', 'as', 'from', 'has', 'have', 'had',
  'not', 'no', 'but', 'i', 'we', 'they', 'he', 'she',
]);

// Domain synonym groups — every member maps to a shared group token so that
// semantically related words land close together in vector space.
const SYNONYM_GROUPS: Record<string, string[]> = {
  loss: ['lost', 'loss', 'missing', 'vanished', 'disappeared', 'never', 'nonreceipt', 'gone', 'stolen', 'theft', 'porch', 'misplaced'],
  damage: ['damage', 'damaged', 'broken', 'cracked', 'crushed', 'smashed', 'shattered', 'dented', 'bent', 'sheared', 'destroyed'],
  shortage: ['shortage', 'short', 'partial', 'incomplete', 'shortfall', 'pieces', 'units', 'count'],
  gemstone: ['diamond', 'sapphire', 'ruby', 'emerald', 'gem', 'gemstone', 'stone', 'jewel', 'jewelry', 'unset', 'loose'],
  currency: ['cash', 'currency', 'money', 'bills', 'bullion', 'coin', 'coins', 'notes', 'banknote'],
  perishable: ['perishable', 'food', 'flowers', 'plant', 'fresh', 'spoil', 'spoilage'],
  packaging: ['packaging', 'package', 'box', 'carton', 'packing', 'void', 'overbox', 'underpacked'],
  waiting: ['waiting', 'period', 'window', 'premature', 'early', 'elapsed', 'filing'],
  tracking: ['tracking', 'scan', 'delivered', 'delivery', 'transit', 'signature', 'signed', 'exception'],
  value: ['value', 'invoice', 'amount', 'payout', 'cap', 'insured', 'deductible', 'reimburse'],
  escalation: ['escalate', 'escalation', 'highvalue', 'expensive', 'material', 'review', 'signoff'],
  international: ['international', 'intl', 'customs', 'crossborder', 'overseas', 'abroad'],
  exclusion: ['exclusion', 'excluded', 'exclude', 'prohibited', 'restricted', 'consignment', 'memorandum'],
  fraud: ['fraud', 'fraudulent', 'flagged', 'mismatch', 'suspicious', 'duplicate'],
};
const WORD_TO_GROUP: Record<string, string> = {};
for (const [group, words] of Object.entries(SYNONYM_GROUPS)) {
  for (const w of words) WORD_TO_GROUP[w] = group;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));

  const feats: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    feats.push(`w:${w}`);
    // domain group token (strong synonym signal)
    const g = WORD_TO_GROUP[w];
    if (g) {
      feats.push(`g:${g}`, `g:${g}`); // weight the group token
    }
    // word bigram
    if (i + 1 < words.length) feats.push(`b:${w}_${words[i + 1]}`);
    // char trigrams (subword robustness)
    const padded = `#${w}#`;
    for (let j = 0; j + 3 <= padded.length; j++) feats.push(`t:${padded.slice(j, j + 3)}`);
  }
  return feats;
}

class HashingProvider implements EmbeddingProvider {
  readonly name = 'feature-hash';
  readonly dims = 384;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const vec = new Array<number>(this.dims).fill(0);
    const feats = tokens(text);
    if (feats.length === 0) return vec;
    // term-frequency with sublinear damping
    const tf = new Map<string, number>();
    for (const f of feats) tf.set(f, (tf.get(f) ?? 0) + 1);
    for (const [feat, count] of tf) {
      const weight = 1 + Math.log(count);
      const h = fnv1a(feat);
      const idx = h % this.dims;
      const sign = (fnv1a(`s:${feat}`) & 1) === 0 ? 1 : -1;
      vec[idx] += sign * weight;
    }
    // L2 normalize
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }
}

// ---------------------------------------------------------------------------
// Hosted API providers (used only when a key is present)
// ---------------------------------------------------------------------------

class OpenAIProvider implements EmbeddingProvider {
  readonly name = 'openai:text-embedding-3-small';
  readonly dims = 1536;
  constructor(private readonly key: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

class VoyageProvider implements EmbeddingProvider {
  readonly name = 'voyage:voyage-3';
  readonly dims = 1024;
  constructor(private readonly key: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'voyage-3', input: texts }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

let _provider: EmbeddingProvider | null = null;
export function getEmbeddingProvider(): EmbeddingProvider {
  if (_provider) return _provider;
  if (Config.OPENAI_API_KEY) _provider = new OpenAIProvider(Config.OPENAI_API_KEY);
  else if (Config.VOYAGE_API_KEY) _provider = new VoyageProvider(Config.VOYAGE_API_KEY);
  else _provider = new HashingProvider();
  return _provider;
}
