/**
 * @shared — the single source of truth for every type that crosses the
 * client/server boundary. Imported by both apps via the "@shared" path alias
 * (see tsconfig.base.json + vite.config.ts). Pure types + small enums only;
 * no runtime dependencies so it can be consumed as source by tsx and Vite alike.
 *
 * Domain: a FICTIONAL shipping-insurance carrier, "Aegis". All clients,
 * carriers, coverage rules, and claims are synthetic.
 */

// ---------------------------------------------------------------------------
// Core domain
// ---------------------------------------------------------------------------

export type ClaimType = 'loss' | 'damage' | 'shortage';

/** Lifecycle status of a claim. Mirrors a real adjudication pipeline. */
export type ClaimStatus =
  | 'new' // freshly filed, untouched
  | 'in_review' // a human or the agent is looking at it
  | 'awaiting_docs' // the agent requested documents
  | 'pending_signoff' // agent decided; awaiting human sign-off (the default agent target)
  | 'approved'
  | 'denied'
  | 'escalated';

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  new: 'New',
  in_review: 'In Review',
  awaiting_docs: 'Awaiting Documents',
  pending_signoff: 'Pending Sign-off',
  approved: 'Approved',
  denied: 'Denied',
  escalated: 'Escalated',
};

export interface Carrier {
  id: number;
  code: string; // e.g. "MERIDIAN"
  name: string; // e.g. "Meridian Freight"
  color: string; // hex, for UI chips
  /** Average days from last scan before a parcel is presumed lost. */
  presumedLostDays: number;
}

export interface Client {
  id: number;
  name: string;
  /** Account tier — drives some SOP-style overrides. */
  tier: 'standard' | 'preferred' | 'enterprise';
  domesticWaitingDays: number; // days before a loss can be adjudicated
  intlWaitingDays: number;
  maxFileDays: number; // filing window after ship date
  allowEarlyFile: boolean;
  /** Free-text, synthetic, per-client handling note (NOT real SOP data). */
  handlingNote: string | null;
  deductible: number; // applied to payouts
}

export interface Claim {
  id: number;
  publicRef: string; // e.g. "AEG-2026-001042" — human-facing
  clientId: number;
  carrierId: number;
  type: ClaimType;
  status: ClaimStatus;
  itemDescription: string;
  /** Why the claimant says the loss/damage happened. */
  narrative: string;
  declaredValue: number; // value the shipper declared
  insuredAmount: number; // coverage cap
  amountClaimed: number; // what the claimant is asking for
  trackingNumber: string;
  shipDate: string; // ISO date
  filedDate: string; // ISO date
  originZip: string;
  destZip: string;
  isInternational: boolean;
  claimantEmail: string;
  /** Set when a human adjudicator recorded the "true" answer (ground truth for backtests). */
  groundTruthDecision: DecisionKind | null;
  groundTruthNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Claim joined with its client + carrier display info. */
export interface ClaimWithRefs extends Claim {
  clientName: string;
  carrierName: string;
  carrierCode: string;
  carrierColor: string;
}

// ---------------------------------------------------------------------------
// Documents & analysis
// ---------------------------------------------------------------------------

export type DocumentKind =
  | 'invoice'
  | 'photo'
  | 'affidavit'
  | 'carrier_response'
  | 'packing_slip'
  | 'tracking_screenshot';

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  invoice: 'Commercial Invoice',
  photo: 'Damage Photo',
  affidavit: 'Consignee Affidavit',
  carrier_response: 'Carrier Response',
  packing_slip: 'Packing Slip',
  tracking_screenshot: 'Tracking Screenshot',
};

/** A required document type the agent can ask for. */
export interface DocType {
  id: number;
  code: DocumentKind;
  label: string;
}

export interface ClaimDocument {
  id: number;
  claimId: number;
  kind: DocumentKind;
  filename: string;
  mime: string;
  /** OCR/extractable text for text-based docs (invoices, affidavits). */
  textContent: string | null;
  /** Populated once analyzed. */
  analyzed: boolean;
  extractedAmount: number | null;
  extractedTracking: string | null;
  extractedDocType: DocumentKind | null;
  analysisConfidence: number | null;
  analysisNotes: string | null;
  uploadedAt: string;
}

/** Result of running the document analyzer over one document. */
export interface DocAnalysis {
  documentId: number;
  filename: string;
  kind: DocumentKind;
  detectedDocType: DocumentKind;
  amount: number | null;
  tracking: string | null;
  confidence: number;
  notes: string;
  /** True if a real vision/LLM model produced this, false for the heuristic fallback. */
  usedModel: boolean;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export interface TrackingEvent {
  timestamp: string; // ISO
  status: string;
  location: string;
}

export type TrackingState =
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned'
  | 'no_data';

export interface TrackingStatus {
  trackingNumber: string;
  carrierCode: string;
  state: TrackingState;
  lastScan: string | null; // ISO
  lastLocation: string | null;
  daysSinceLastScan: number | null;
  deliveredDate: string | null;
  events: TrackingEvent[];
  /** True if a live carrier API answered; false for the deterministic simulator. */
  live: boolean;
}

// ---------------------------------------------------------------------------
// RAG / knowledge base
// ---------------------------------------------------------------------------

export type KnowledgeCategory =
  | 'coverage_rule'
  | 'exclusion'
  | 'procedure'
  | 'precedent'; // a past adjudicated claim used as a precedent

export interface KnowledgeChunk {
  id: number;
  category: KnowledgeCategory;
  title: string;
  text: string;
  source: string; // e.g. "Aegis Coverage Handbook §3.2" (synthetic)
  /** Present only on server-side; not always shipped to the client. */
  embedding?: number[];
}

/** A retrieved chunk with relevance score (and optional 2-D projection). */
export interface RagCitation {
  chunkId: number;
  category: KnowledgeCategory;
  title: string;
  text: string;
  source: string;
  score: number; // cosine similarity 0..1
}

export interface SemanticSearchResult extends RagCitation {
  /** 2-D PCA projection of the embedding, for the vector-space map. */
  x: number;
  y: number;
}

export interface VectorPoint {
  id: number;
  category: KnowledgeCategory;
  title: string;
  x: number;
  y: number;
}

export interface SemanticSearchResponse {
  query: string;
  provider: string; // which embedding provider answered
  dims: number;
  results: SemanticSearchResult[];
  /** Every knowledge chunk projected to 2-D, so the map can show the full space. */
  cloud: VectorPoint[];
  /** Projection of the query vector itself. */
  queryPoint: { x: number; y: number };
  tookMs: number;
}

// ---------------------------------------------------------------------------
// Agent decision
// ---------------------------------------------------------------------------

export type DecisionKind = 'approve' | 'deny' | 'request_docs' | 'escalate';

export const DECISION_LABELS: Record<DecisionKind, string> = {
  approve: 'Approve',
  deny: 'Deny',
  request_docs: 'Request Documents',
  escalate: 'Escalate',
};

/** One deterministic pre-flight check the engine runs before any AI. */
export interface PreflightCheck {
  name: string;
  passed: boolean;
  /** When false + terminal, this short-circuits the whole decision. */
  terminal: boolean;
  detail: string;
}

/** A reasoning-vs-decision or confidence guard rail. */
export interface GateResult {
  name: string;
  passed: boolean;
  note: string;
}

export interface ClaimDecision {
  claimId: number;
  decision: DecisionKind;
  /** Resulting claim status the engine would set. */
  resultingStatus: ClaimStatus;
  confidence: number; // 0..1
  paidAmount: number | null;
  denialReason: string | null;
  missingDocTypeIds: number[];
  escalationReason: string | null;
  /** Structured, step-by-step reasoning (STEP 1.. STEP 5..). */
  reasoning: string;
  flags: string[];
  /** Citations retrieved by the RAG pipeline that informed this decision. */
  citations: RagCitation[];
  preflights: PreflightCheck[];
  gates: GateResult[];
  /** Provenance. */
  model: string;
  usedRealModel: boolean;
  inputTokens: number;
  outputTokens: number;
  /** Wall-clock for the decision. */
  tookMs: number;
  decidedAt: string;
}

// ---------------------------------------------------------------------------
// Live agent run — Server-Sent Events stream
// ---------------------------------------------------------------------------

export type AgentStage =
  | 'context'
  | 'preflight'
  | 'documents'
  | 'tracking'
  | 'retrieval'
  | 'reasoning'
  | 'gates'
  | 'decision';

export const AGENT_STAGE_LABELS: Record<AgentStage, string> = {
  context: 'Assembling context',
  preflight: 'Deterministic pre-flights',
  documents: 'Analyzing documents',
  tracking: 'Resolving carrier tracking',
  retrieval: 'RAG retrieval',
  reasoning: 'Claude reasoning',
  gates: 'Guard rails',
  decision: 'Final decision',
};

export type AgentEvent =
  | { type: 'stage'; stage: AgentStage; phase: 'start' | 'done'; detail?: string }
  | { type: 'preflight'; checks: PreflightCheck[] }
  | { type: 'documents'; analyses: DocAnalysis[] }
  | { type: 'tracking'; tracking: TrackingStatus }
  | { type: 'retrieval'; query: string; citations: RagCitation[] }
  | { type: 'thinking'; text: string } // streamed extended-thinking tokens
  | { type: 'token'; text: string } // streamed answer tokens
  | { type: 'gate'; gate: GateResult }
  | { type: 'decision'; decision: ClaimDecision }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ---------------------------------------------------------------------------
// Backtesting / evaluation
// ---------------------------------------------------------------------------

export interface BacktestRow {
  claimId: number;
  publicRef: string;
  itemDescription: string;
  groundTruth: DecisionKind;
  groundTruthNote: string | null;
  agentDecision: DecisionKind;
  agentConfidence: number;
  agree: boolean;
  tookMs: number;
}

export interface BacktestSummary {
  runId: string;
  total: number;
  agreed: number;
  accuracy: number; // 0..1
  /** confusion-style matrix: matrix[truth][predicted] = count */
  matrix: Record<DecisionKind, Record<DecisionKind, number>>;
  rows: BacktestRow[];
  avgConfidence: number;
  avgTookMs: number;
  finishedAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard / stats
// ---------------------------------------------------------------------------

export interface DashboardStats {
  totalClaims: number;
  byStatus: Record<ClaimStatus, number>;
  byType: Record<ClaimType, number>;
  /** Total dollars currently insured across all open claims. */
  openExposure: number;
  /** Total dollars the agent has approved for payout. */
  approvedPayout: number;
  decidedByAgent: number;
  avgConfidence: number;
  /** Recent agent decisions, newest first. */
  recentDecisions: {
    claimId: number;
    publicRef: string;
    decision: DecisionKind;
    confidence: number;
    decidedAt: string;
  }[];
  /** System provenance, surfaced in the UI so reviewers know what's live. */
  capabilities: SystemCapabilities;
}

export interface SystemCapabilities {
  llm: { provider: 'anthropic' | 'simulator'; model: string };
  embeddings: { provider: string; dims: number };
  database: { driver: string };
  knowledgeChunks: number;
}
