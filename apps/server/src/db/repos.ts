/**
 * Repositories — the only place that knows SQL column names. Everything else
 * works with the clean domain types from @shared. Row → domain mapping lives
 * here, which is why the underlying schema can use its own vocabulary
 * (cases / couriers / merchants / adjudications…) without affecting the app.
 */
import { getDb } from './connection.js';
import type {
  Carrier,
  Claim,
  ClaimDecision,
  ClaimDocument,
  ClaimStatus,
  ClaimType,
  ClaimWithRefs,
  Client,
  DecisionKind,
  DocType,
  KnowledgeChunk,
  TrackingEvent,
} from '@shared';

const db = () => getDb();

// ---------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------
export function listCarriers(): Carrier[] {
  return db()
    .all<Record<string, any>>('SELECT * FROM couriers ORDER BY courier_id')
    .map((r) => ({ id: r.courier_id, code: r.courier_code, name: r.courier_name, color: r.swatch, presumedLostDays: r.transit_loss_threshold_days }));
}

export function getClient(id: number): Client | undefined {
  const r = db().get<Record<string, any>>('SELECT * FROM merchants WHERE merchant_id = ?', [id]);
  return r ? mapClient(r) : undefined;
}
export function listClients(): Client[] {
  return db().all<Record<string, any>>('SELECT * FROM merchants ORDER BY merchant_id').map(mapClient);
}
function mapClient(r: Record<string, any>): Client {
  return {
    id: r.merchant_id,
    name: r.merchant_name,
    tier: r.service_tier,
    domesticWaitingDays: r.dom_hold_days,
    intlWaitingDays: r.intl_hold_days,
    maxFileDays: r.file_window_days,
    allowEarlyFile: !!r.allows_early_file,
    handlingNote: r.ops_note ?? null,
    deductible: r.deductible_usd,
  };
}

export function listDocTypes(): DocType[] {
  return db()
    .all<Record<string, any>>('SELECT * FROM evidence_types ORDER BY evidence_type_id')
    .map((r) => ({ id: r.evidence_type_id, code: r.evidence_code, label: r.evidence_label }));
}
export function docTypeIdByCode(code: string): number | undefined {
  return db().get<{ id: number }>('SELECT evidence_type_id AS id FROM evidence_types WHERE evidence_code = ?', [code])?.id;
}

// ---------------------------------------------------------------------------
// Cases (claims)
// ---------------------------------------------------------------------------
const CASE_SELECT = `
  SELECT c.*, m.merchant_name AS client_name,
         co.courier_name AS carrier_name, co.courier_code AS carrier_code, co.swatch AS carrier_color
  FROM cases c
  JOIN merchants m ON m.merchant_id = c.merchant_id
  JOIN couriers co ON co.courier_id = c.courier_id`;

export function listClaims(filters: { status?: string; type?: string; q?: string } = {}): ClaimWithRefs[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status) {
    where.push('c.lifecycle_state = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    where.push('c.peril = ?');
    params.push(filters.type);
  }
  if (filters.q) {
    where.push('(c.goods_description LIKE ? OR c.case_ref LIKE ? OR c.claimant_statement LIKE ?)');
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  const sql = `${CASE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.filed_on DESC, c.case_id DESC`;
  return db().all<Record<string, any>>(sql, params).map(mapClaimWithRefs);
}

export function getClaim(id: number): ClaimWithRefs | undefined {
  const r = db().get<Record<string, any>>(`${CASE_SELECT} WHERE c.case_id = ?`, [id]);
  return r ? mapClaimWithRefs(r) : undefined;
}

export function claimsWithGroundTruth(): ClaimWithRefs[] {
  return db()
    .all<Record<string, any>>(`${CASE_SELECT} WHERE c.truth_label IS NOT NULL ORDER BY c.case_id`)
    .map(mapClaimWithRefs);
}

function mapClaim(r: Record<string, any>): Claim {
  return {
    id: r.case_id,
    publicRef: r.case_ref,
    clientId: r.merchant_id,
    carrierId: r.courier_id,
    type: r.peril as ClaimType,
    status: r.lifecycle_state as ClaimStatus,
    itemDescription: r.goods_description,
    narrative: r.claimant_statement,
    declaredValue: r.declared_usd,
    insuredAmount: r.coverage_limit_usd,
    amountClaimed: r.demand_usd,
    trackingNumber: r.shipment_ref,
    shipDate: r.dispatched_on,
    filedDate: r.filed_on,
    originZip: r.origin_postal,
    destZip: r.dest_postal,
    isInternational: !!r.cross_border,
    claimantEmail: r.claimant_contact,
    groundTruthDecision: (r.truth_label ?? null) as DecisionKind | null,
    groundTruthNote: r.truth_label_note ?? null,
    createdAt: r.opened_at,
    updatedAt: r.touched_at,
  };
}
function mapClaimWithRefs(r: Record<string, any>): ClaimWithRefs {
  return {
    ...mapClaim(r),
    clientName: r.client_name,
    carrierName: r.carrier_name,
    carrierCode: r.carrier_code,
    carrierColor: r.carrier_color,
  };
}

export function updateClaimStatus(id: number, status: ClaimStatus): void {
  db().run('UPDATE cases SET lifecycle_state = ?, touched_at = ? WHERE case_id = ?', [status, new Date().toISOString(), id]);
}

// ---------------------------------------------------------------------------
// Evidence (documents)
// ---------------------------------------------------------------------------
export function getDocuments(claimId: number): ClaimDocument[] {
  return db()
    .all<Record<string, any>>('SELECT * FROM evidence_items WHERE case_id = ? ORDER BY evidence_id', [claimId])
    .map(mapDocument);
}
function mapDocument(r: Record<string, any>): ClaimDocument {
  return {
    id: r.evidence_id,
    claimId: r.case_id,
    kind: r.evidence_kind,
    filename: r.file_name,
    mime: r.media_type,
    textContent: r.ocr_text ?? null,
    analyzed: !!r.is_extracted,
    extractedAmount: r.extracted_value_usd ?? null,
    extractedTracking: r.extracted_shipment_ref ?? null,
    extractedDocType: r.extracted_kind ?? null,
    analysisConfidence: r.extraction_score ?? null,
    analysisNotes: r.extraction_note ?? null,
    uploadedAt: r.captured_at,
  };
}
export function saveDocumentAnalysis(
  docId: number,
  a: { amount: number | null; tracking: string | null; docType: string; confidence: number; notes: string },
): void {
  db().run(
    `UPDATE evidence_items
       SET is_extracted = 1, extracted_value_usd = ?, extracted_shipment_ref = ?, extracted_kind = ?,
           extraction_score = ?, extraction_note = ?
     WHERE evidence_id = ?`,
    [a.amount, a.tracking, a.docType, a.confidence, a.notes, docId],
  );
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------
export function getTrackingEvents(claimId: number): TrackingEvent[] {
  return db()
    .all<Record<string, any>>('SELECT scanned_at, scan_status, scan_locale FROM scan_history WHERE case_id = ? ORDER BY scanned_at ASC', [
      claimId,
    ])
    .map((r) => ({ timestamp: r.scanned_at, status: r.scan_status, location: r.scan_locale }));
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------
export function listKnowledge(withEmbeddings = false): KnowledgeChunk[] {
  return db()
    .all<Record<string, any>>('SELECT * FROM policy_chunks ORDER BY chunk_id')
    .map((r) => ({
      id: r.chunk_id,
      category: r.chunk_kind,
      title: r.heading,
      text: r.body,
      source: r.citation,
      embedding: withEmbeddings && r.vector ? (JSON.parse(r.vector) as number[]) : undefined,
    }));
}
export function knowledgeNeedingEmbedding(expectedDims: number): { id: number; text: string; title: string }[] {
  return db()
    .all<Record<string, any>>('SELECT chunk_id, heading, body, vector FROM policy_chunks ORDER BY chunk_id')
    .filter((r) => {
      if (!r.vector) return true;
      try {
        return (JSON.parse(r.vector) as number[]).length !== expectedDims;
      } catch {
        return true;
      }
    })
    .map((r) => ({ id: r.chunk_id, text: r.body, title: r.heading }));
}
export function saveEmbedding(id: number, vec: number[]): void {
  db().run('UPDATE policy_chunks SET vector = ? WHERE chunk_id = ?', [JSON.stringify(vec), id]);
}

// ---------------------------------------------------------------------------
// Adjudications + ledger
// ---------------------------------------------------------------------------
export function insertDecision(d: ClaimDecision): number {
  const r = db().run(
    `INSERT INTO adjudications
       (case_id, verdict, resulting_state, certainty, award_usd, refusal_basis,
        requested_evidence, referral_basis, rationale, signals, retrieved, gate_checks, guardrails,
        engine, engine_is_live, prompt_tokens, completion_tokens, elapsed_ms, ruled_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      d.claimId, d.decision, d.resultingStatus, d.confidence, d.paidAmount ?? null, d.denialReason ?? null,
      JSON.stringify(d.missingDocTypeIds), d.escalationReason ?? null, d.reasoning, JSON.stringify(d.flags),
      JSON.stringify(d.citations), JSON.stringify(d.preflights), JSON.stringify(d.gates),
      d.model, d.usedRealModel ? 1 : 0, d.inputTokens, d.outputTokens, d.tookMs, d.decidedAt,
    ],
  );
  return r.lastInsertRowid;
}

export function insertChange(claimId: number, oldStatus: string | null, newStatus: string, note: string): void {
  db().run(
    'INSERT INTO case_ledger (case_id, actor, from_state, to_state, memo, logged_at) VALUES (?,?,?,?,?,?)',
    [claimId, 'agent', oldStatus, newStatus, note, new Date().toISOString()],
  );
}

export function insertEvalRun(s: {
  runId: string;
  total: number;
  agreed: number;
  accuracy: number;
  avgConfidence: number;
  avgTookMs: number;
  matrix: unknown;
  rows: unknown;
  finishedAt: string;
}): void {
  db().run(
    `INSERT INTO eval_runs (eval_id, scored, matched, hit_rate, mean_certainty, mean_elapsed_ms, matrix, detail, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [s.runId, s.total, s.agreed, s.accuracy, s.avgConfidence, s.avgTookMs, JSON.stringify(s.matrix), JSON.stringify(s.rows), s.finishedAt],
  );
}

export function getLastDecision(claimId: number): ClaimDecision | null {
  const r = db().get<Record<string, any>>(
    'SELECT * FROM adjudications WHERE case_id = ? ORDER BY ruled_at DESC, adjudication_id DESC LIMIT 1',
    [claimId],
  );
  return r ? mapDecision(r) : null;
}
function mapDecision(r: Record<string, any>): ClaimDecision {
  const parse = <T>(s: string | null, fallback: T): T => {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  };
  return {
    claimId: r.case_id,
    decision: r.verdict,
    resultingStatus: r.resulting_state,
    confidence: r.certainty,
    paidAmount: r.award_usd ?? null,
    denialReason: r.refusal_basis ?? null,
    missingDocTypeIds: parse(r.requested_evidence, []),
    escalationReason: r.referral_basis ?? null,
    reasoning: r.rationale,
    flags: parse(r.signals, []),
    citations: parse(r.retrieved, []),
    preflights: parse(r.gate_checks, []),
    gates: parse(r.guardrails, []),
    model: r.engine,
    usedRealModel: !!r.engine_is_live,
    inputTokens: r.prompt_tokens,
    outputTokens: r.completion_tokens,
    tookMs: r.elapsed_ms,
    decidedAt: r.ruled_at,
  };
}
