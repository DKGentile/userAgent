import type {
  AgentEvent,
  BacktestSummary,
  ClaimDecision,
  ClaimDocument,
  ClaimWithRefs,
  DashboardStats,
  DocAnalysis,
  KnowledgeChunk,
  SemanticSearchResponse,
  SystemCapabilities,
  TrackingStatus,
} from '@shared';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export interface ClaimDetail {
  claim: ClaimWithRefs;
  documents: ClaimDocument[];
  tracking: TrackingStatus;
  lastDecision: ClaimDecision | null;
}

export const api = {
  capabilities: () => get<SystemCapabilities>('/capabilities'),
  stats: () => get<DashboardStats>('/stats'),
  claims: (params: { status?: string; type?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    ).toString();
    return get<ClaimWithRefs[]>(`/claims${qs ? `?${qs}` : ''}`);
  },
  claim: (id: number) => get<ClaimDetail>(`/claims/${id}`),
  analyzeDocuments: (claimId: number) => post<DocAnalysis[]>(`/claims/${claimId}/documents/analyze`),
  search: (q: string) => get<SemanticSearchResponse>(`/search?q=${encodeURIComponent(q)}`),
  knowledge: () => get<KnowledgeChunk[]>('/knowledge'),
  backtest: () => post<BacktestSummary>('/backtest'),
};

/**
 * Stream a live agent run over Server-Sent Events. Returns an abort function.
 * Each `AgentEvent` is delivered to `onEvent` as it arrives.
 */
export function streamAgentRun(
  claimId: number,
  onEvent: (e: AgentEvent) => void,
  onClose?: () => void,
): () => void {
  const es = new EventSource(`${BASE}/claims/${claimId}/agent/stream`);
  es.onmessage = (msg) => {
    if (!msg.data) return;
    try {
      const evt = JSON.parse(msg.data) as AgentEvent;
      onEvent(evt);
      if (evt.type === 'done' || evt.type === 'error') {
        es.close();
        onClose?.();
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  es.onerror = () => {
    es.close();
    onClose?.();
  };
  return () => es.close();
}
