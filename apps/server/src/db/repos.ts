/**
 * Repositories — the only place that knows SQL column names. Everything else
 * works with the clean domain types from @shared. Row → domain mapping lives
 * here.
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
    .all<Record<string, any>>('SELECT * FROM carriers ORDER BY id')
    .map((r) => ({ id: r.id, code: r.code, name: r.name, color: r.color, presumedLostDays: r.presumed_lost_days }));
}

export function getClient(id: number): Client | undefined {
  const r = db().get<Record<string, any>>('SELECT * FROM clients WHERE id = ?', [id]);
  return r ? mapClient(r) : undefined;
}
export function listClients(): Client[] {
  return db().all<Record<string, any>>('SELECT * FROM clients ORDER BY id').map(mapClient);
}
function mapClient(r: Record<string, any>): Client {
  return {
    id: r.id,
    name: r.name,
    tier: r.tier,
    domesticWaitingDays: r.dom_waiting_days,
    intlWaitingDays: r.intl_waiting_days,
    maxFileDays: r.max_file_days,
    allowEarlyFile: !!r.allow_early_file,
    handlingNote: r.handling_note ?? null,
    deductible: r.deductible,
  };
}

export function listDocTypes(): DocType[] {
  return db()
    .all<Record<string, any>>('SELECT * FROM doc_types ORDER BY id')
    .map((r) => ({ id: r.id, code: r.code, label: r.label }));
}
export function docTypeIdByCode(code: string): number | undefined {
  return db().get<{ id: number }>('SELECT id FROM doc_types WHERE code = ?', [code])?.id;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
const CLAIM_SELECT = `
  SELECT c.*, cl.name AS client_name,
         ca.name AS carrier_name, ca.code AS carrier_code, ca.color AS carrier_color
  FROM claims c
  JOIN clients cl ON cl.id = c.client_id
  JOIN carriers ca ON ca.id = c.carrier_id`;

export function listClaims(filters: { status?: string; type?: string; q?: string } = {}): ClaimWithRefs[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status) {
    where.push('c.status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    where.push('c.type = ?');
    params.push(filters.type);
  }
  if (filters.q) {
    where.push('(c.item_description LIKE ? OR c.public_ref LIKE ? OR c.narrative LIKE ?)');
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  const sql = `${CLAIM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.filed_date DESC, c.id DESC`;
  return db().all<Record<string, any>>(sql, params).map(mapClaimWithRefs);
}

export function getClaim(id: number): ClaimWithRefs | undefined {
  const r = db().get<Record<string, any>>(`${CLAIM_SELECT} WHERE c.id = ?`, [id]);
  return r ? mapClaimWithRefs(r) : undefined;
}

export function claimsWithGroundTruth(): ClaimWithRefs[] {
  return db()
    .all<Record<string, any>>(`${CLAIM_SELECT} WHERE c.ground_truth_decision IS NOT NULL ORDER BY c.id`)
    .map(mapClaimWithRefs);
}

function mapClaim(r: Record<string, any>): Claim {
  return {
    id: r.id,
    publicRef: r.public_ref,
    clientId: r.client_id,
    carrierId: r.carrier_id,
    type: r.type as ClaimType,
    status: r.status as ClaimStatus,
    itemDescription: r.item_description,
    narrative: r.narrative,
    declaredValue: r.declared_value,
    insuredAmount: r.insured_amount,
    amountClaimed: r.amount_claimed,
    trackingNumber: r.tracking_number,
    shipDate: r.ship_date,
    filedDate: r.filed_date,
    originZip: r.origin_zip,
    destZip: r.dest_zip,
    isInternational: !!r.is_international,
    claimantEmail: r.claimant_email,
    groundTruthDecision: (r.ground_truth_decision ?? null) as DecisionKind | null,
    groundTruthNote: r.ground_truth_note ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
  db().run('UPDATE claims SET status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), id]);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export function getDocuments(claimId: number): ClaimDocument[] {
  return db()
    .all<Record<string, any>>('SELECT * FROM claim_documents WHERE claim_id = ? ORDER BY id', [claimId])
    .map(mapDocument);
}
function mapDocument(r: Record<string, any>): ClaimDocument {
  return {
    id: r.id,
    claimId: r.claim_id,
    kind: r.kind,
    filename: r.filename,
    mime: r.mime,
    textContent: r.text_content ?? null,
    analyzed: !!r.analyzed,
    extractedAmount: r.extracted_amount ?? null,
    extractedTracking: r.extracted_tracking ?? null,
    extractedDocType: r.extracted_doc_type ?? null,
    analysisConfidence: r.analysis_confidence ?? null,
    analysisNotes: r.analysis_notes ?? null,
    uploadedAt: r.uploaded_at,
  };
}
export function saveDocumentAnalysis(
  docId: number,
  a: { amount: number | null; tracking: string | null; docType: string; confidence: number; notes: string },
): void {
  db().run(
    `UPDATE claim_documents
       SET analyzed = 1, extracted_amount = ?, extracted_tracking = ?, extracted_doc_type = ?,
           analysis_confidence = ?, analysis_notes = ?
     WHERE id = ?`,
    [a.amount, a.tracking, a.docType, a.confidence, a.notes, docId],
  );
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------
export function getTrackingEvents(claimId: number): TrackingEvent[] {
  return db()
    .all<Record<string, any>>('SELECT ts, status, location FROM tracking_events WHERE claim_id = ? ORDER BY ts ASC', [
      claimId,
    ])
    .map((r) => ({ timestamp: r.ts, status: r.status, location: r.location }));
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------
export function listKnowledge(withEmbeddings = false): KnowledgeChunk[] {
  return db()
    .all<Record<string, any>>('SELECT * FROM knowledge_chunks ORDER BY id')
    .map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      text: r.text,
      source: r.source,
      embedding: withEmbeddings && r.embedding ? (JSON.parse(r.embedding) as number[]) : undefined,
    }));
}
export function knowledgeNeedingEmbedding(expectedDims: number): { id: number; text: string; title: string }[] {
  return db()
    .all<Record<string, any>>('SELECT id, title, text, embedding FROM knowledge_chunks ORDER BY id')
    .filter((r) => {
      if (!r.embedding) return true;
      try {
        return (JSON.parse(r.embedding) as number[]).length !== expectedDims;
      } catch {
        return true;
      }
    })
    .map((r) => ({ id: r.id, text: r.text, title: r.title }));
}
export function saveEmbedding(id: number, vec: number[]): void {
  db().run('UPDATE knowledge_chunks SET embedding = ? WHERE id = ?', [JSON.stringify(vec), id]);
}

// ---------------------------------------------------------------------------
// Decisions + audit
// ---------------------------------------------------------------------------
export function insertDecision(d: ClaimDecision): number {
  const r = db().run(
    `INSERT INTO agent_decisions
       (claim_id, decision, resulting_status, confidence, paid_amount, denial_reason,
        missing_doc_type_ids, escalation_reason, reasoning, flags, citations, preflights, gates,
        model, used_real_model, input_tokens, output_tokens, took_ms, decided_at)
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
    'INSERT INTO agent_changes (claim_id, change_type, old_status, new_status, note, created_at) VALUES (?,?,?,?,?,?)',
    [claimId, 'AI_AGENT', oldStatus, newStatus, note, new Date().toISOString()],
  );
}

export function insertBacktestRun(s: {
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
    `INSERT INTO backtest_runs (run_id, total, agreed, accuracy, avg_confidence, avg_took_ms, matrix, rows, finished_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [s.runId, s.total, s.agreed, s.accuracy, s.avgConfidence, s.avgTookMs, JSON.stringify(s.matrix), JSON.stringify(s.rows), s.finishedAt],
  );
}

export function getLastDecision(claimId: number): ClaimDecision | null {
  const r = db().get<Record<string, any>>(
    'SELECT * FROM agent_decisions WHERE claim_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1',
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
    claimId: r.claim_id,
    decision: r.decision,
    resultingStatus: r.resulting_status,
    confidence: r.confidence,
    paidAmount: r.paid_amount ?? null,
    denialReason: r.denial_reason ?? null,
    missingDocTypeIds: parse(r.missing_doc_type_ids, []),
    escalationReason: r.escalation_reason ?? null,
    reasoning: r.reasoning,
    flags: parse(r.flags, []),
    citations: parse(r.citations, []),
    preflights: parse(r.preflights, []),
    gates: parse(r.gates, []),
    model: r.model,
    usedRealModel: !!r.used_real_model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    tookMs: r.took_ms,
    decidedAt: r.decided_at,
  };
}
