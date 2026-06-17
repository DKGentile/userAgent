/**
 * RAG pipeline. Two entry points:
 *   - retrieve(queryText, k)       used by the decision agent to pull policy +
 *                                  precedent context into the prompt.
 *   - semanticSearch(queryText)    powers the interactive vector-space explorer.
 */
import { getEmbeddingProvider } from './embeddings.js';
import { allCoords, chunkById, embedQuery, projectQuery, searchByVector } from './vectorStore.js';
import type { RagCitation, SemanticSearchResponse, VectorPoint } from '@shared';

export async function retrieve(queryText: string, k = 5): Promise<RagCitation[]> {
  const qvec = await embedQuery(queryText);
  return searchByVector(qvec, k).map((s) => ({
    chunkId: s.chunk.id,
    category: s.chunk.category,
    title: s.chunk.title,
    text: s.chunk.text,
    source: s.chunk.source,
    score: round(s.score),
  }));
}

export async function semanticSearch(queryText: string, k = 8): Promise<SemanticSearchResponse> {
  const provider = getEmbeddingProvider();
  const start = performance.now();
  const qvec = await embedQuery(queryText);
  const hits = searchByVector(qvec, k);
  const [qx, qy] = projectQuery(qvec);
  const tookMs = Math.round(performance.now() - start);

  const cloud: VectorPoint[] = allCoords().flatMap(({ id, coords }) => {
    const c = chunkById(id);
    return c ? [{ id, category: c.category, title: c.title, x: round(coords[0], 4), y: round(coords[1], 4) }] : [];
  });

  return {
    query: queryText,
    provider: provider.name,
    dims: provider.dims,
    cloud,
    results: hits.map((s) => ({
      chunkId: s.chunk.id,
      category: s.chunk.category,
      title: s.chunk.title,
      text: s.chunk.text,
      source: s.chunk.source,
      score: round(s.score),
      x: round(s.coords[0], 4),
      y: round(s.coords[1], 4),
    })),
    queryPoint: { x: round(qx, 4), y: round(qy, 4) },
    tookMs,
  };
}

/** Build the retrieval query string from a claim's salient facts. */
export function claimQueryText(facts: {
  type: string;
  item: string;
  narrative: string;
  isInternational: boolean;
  trackingState: string;
}): string {
  return [
    `${facts.type} claim`,
    facts.item,
    facts.narrative,
    facts.isInternational ? 'international shipment' : 'domestic shipment',
    `tracking ${facts.trackingState}`,
  ].join('. ');
}

function round(n: number, digits = 3): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
