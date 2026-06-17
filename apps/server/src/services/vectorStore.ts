/**
 * In-memory vector store over the knowledge base. On init it ensures every
 * chunk has an embedding from the active provider (re-embedding if the
 * provider/dimensionality changed), loads the vectors into memory, and fits a
 * 2-D PCA projection used by the semantic-search map.
 */
import { getEmbeddingProvider } from './embeddings.js';
import { fitPCA, type Projector } from './pca.js';
import {
  knowledgeNeedingEmbedding,
  listKnowledge,
  saveEmbedding,
} from '../db/repos.js';
import type { KnowledgeChunk } from '@shared';

interface StoredVector {
  id: number;
  vec: number[]; // L2-normalized
  coords: [number, number];
}

let _vectors: StoredVector[] = [];
let _chunks = new Map<number, KnowledgeChunk>();
let _projector: Projector = { project: () => [0, 0] };
let _ready = false;

function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}
function cosine(a: number[], b: number[]): number {
  // both stored normalized -> dot product is cosine
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

export async function initVectorStore(): Promise<void> {
  const provider = getEmbeddingProvider();

  // Backfill embeddings for any chunk that lacks one (or has wrong dims).
  const pending = knowledgeNeedingEmbedding(provider.dims);
  if (pending.length > 0) {
    const vecs = await provider.embed(pending.map((p) => `${p.title}. ${p.text}`));
    pending.forEach((p, i) => saveEmbedding(p.id, vecs[i]));
  }

  const chunks = listKnowledge(true);
  _chunks = new Map(chunks.map((c) => [c.id, c]));
  const raw = chunks
    .filter((c) => c.embedding && c.embedding.length === provider.dims)
    .map((c) => ({ id: c.id, vec: normalize(c.embedding!) }));

  const projector = fitPCA(raw.map((r) => r.vec));
  _vectors = raw.map((r) => ({ id: r.id, vec: r.vec, coords: projector.project(r.vec) }));
  _projector = projector;
  _ready = true;
}

export function isReady(): boolean {
  return _ready;
}

export async function embedQuery(text: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  const [v] = await provider.embed([text]);
  return normalize(v);
}

export interface ScoredChunk {
  chunk: KnowledgeChunk;
  score: number;
  coords: [number, number];
}

/** Top-k chunks by cosine similarity to a (normalized) query vector. */
export function searchByVector(queryVec: number[], k = 5): ScoredChunk[] {
  const scored = _vectors.map((sv) => ({
    chunk: _chunks.get(sv.id)!,
    score: cosine(queryVec, sv.vec),
    coords: sv.coords,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function allCoords(): { id: number; coords: [number, number] }[] {
  return _vectors.map((v) => ({ id: v.id, coords: v.coords }));
}

export function projectQuery(queryVec: number[]): [number, number] {
  return _projector.project(queryVec);
}

export function chunkById(id: number): KnowledgeChunk | undefined {
  return _chunks.get(id);
}
