/**
 * Synthetic seed data — all fictional. Builds a believable claims book for the
 * fictional carrier "Aegis": carriers, merchant clients, ~26 claims spanning
 * every decision branch, their documents and carrier tracking, a handful of
 * already-adjudicated historical decisions, and the RAG knowledge base.
 *
 * Run standalone:  npm run seed   (drops + rebuilds)
 * Used on boot:    seedIfEmpty(db) (only seeds a fresh database)
 */
import { getDb, type SqlDb } from './connection.js';
import { migrate } from './migrate.js';
import { KNOWLEDGE } from './knowledge.js';
import type { ClaimType, DecisionKind, DocumentKind } from '@shared';

// ---------------------------------------------------------------------------
// Date helpers (seed runs in normal Node — Date is fine here)
// ---------------------------------------------------------------------------
const NOW = new Date();
function dayISO(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function timeISO(daysAgo: number, hour = 10): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 22, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const CARRIERS = [
  { id: 1, code: 'MERIDIAN', name: 'Meridian Freight', color: '#f59e0b', presumed: 25 },
  { id: 2, code: 'NORTHWIND', name: 'Northwind Parcel', color: '#38bdf8', presumed: 21 },
  { id: 3, code: 'SUMMIT', name: 'Summit Express', color: '#34d399', presumed: 20 },
  { id: 4, code: 'ORION', name: 'Orion Global', color: '#a78bfa', presumed: 30 },
  { id: 5, code: 'CASCADE', name: 'Cascade Post', color: '#fb7185', presumed: 28 },
];

const CLIENTS = [
  { id: 1, name: 'Lumen Optics Co.', tier: 'preferred', dom: 21, intl: 45, maxFile: 90, early: 0, note: null, deductible: 0 },
  { id: 2, name: 'Harbor & Vine', tier: 'standard', dom: 21, intl: 45, maxFile: 90, early: 0, note: null, deductible: 25 },
  { id: 3, name: 'Atlas Outfitters', tier: 'enterprise', dom: 15, intl: 40, maxFile: 120, early: 1, note: 'Enterprise SLA: prioritize; affidavit not required when the carrier independently confirms loss.', deductible: 0 },
  { id: 4, name: 'Petal & Co.', tier: 'standard', dom: 21, intl: 45, maxFile: 60, early: 0, note: null, deductible: 50 },
  { id: 5, name: 'Forge Athletics', tier: 'preferred', dom: 20, intl: 45, maxFile: 90, early: 0, note: null, deductible: 0 },
  { id: 6, name: 'Nimbus Audio', tier: 'standard', dom: 21, intl: 45, maxFile: 90, early: 0, note: null, deductible: 0 },
  { id: 7, name: 'Verdant Home', tier: 'enterprise', dom: 15, intl: 40, maxFile: 120, early: 1, note: 'Do not request packing photos — supplier ships flat-packed with no interior void fill.', deductible: 0 },
  { id: 8, name: 'Cobalt Tools', tier: 'standard', dom: 21, intl: 45, maxFile: 90, early: 0, note: null, deductible: 35 },
];

const DOC_TYPES: { id: number; code: DocumentKind; label: string }[] = [
  { id: 1, code: 'invoice', label: 'Commercial Invoice' },
  { id: 2, code: 'photo', label: 'Damage Photos' },
  { id: 3, code: 'affidavit', label: 'Consignee Affidavit' },
  { id: 4, code: 'carrier_response', label: 'Carrier Response' },
  { id: 5, code: 'packing_slip', label: 'Packing Slip' },
  { id: 6, code: 'tracking_screenshot', label: 'Tracking Screenshot' },
];

// ---------------------------------------------------------------------------
// Document text generators (synthetic "OCR-able" content)
// ---------------------------------------------------------------------------
function invoiceText(item: string, amount: number, tracking: string, seller: string): string {
  return [
    `${seller.toUpperCase()} — COMMERCIAL INVOICE`,
    `Invoice #: INV-${Math.floor(amount)}-${tracking.slice(-4)}`,
    `Ship reference / tracking: ${tracking}`,
    `Description: ${item}`,
    `Merchandise subtotal: $${amount.toFixed(2)}`,
    `Shipping & handling: $0.00`,
    `TOTAL DUE: $${amount.toFixed(2)}`,
  ].join('\n');
}
function affidavitText(name: string, item: string, signed = true): string {
  return [
    'CONSIGNEE AFFIDAVIT OF NON-RECEIPT',
    `I, ${name}, declare under penalty of perjury that I have not received the shipment`,
    `containing: ${item}. I have searched my premises and checked with neighbors and my`,
    `local carrier facility. The parcel has not been delivered to me.`,
    signed ? `Signed: ${name}` : `(unsigned draft)`,
  ].join('\n');
}
function packingSlipText(item: string, shipped: number, received: number): string {
  return [
    'PACKING SLIP',
    `Contents: ${item}`,
    `Quantity shipped: ${shipped}`,
    `Quantity received by consignee: ${received}`,
    `Shortfall: ${shipped - received} unit(s)`,
  ].join('\n');
}
function carrierResponseText(tracking: string, body: string): string {
  return ['CARRIER CLAIM RESPONSE', `Tracking: ${tracking}`, body].join('\n');
}

// ---------------------------------------------------------------------------
// Claim specs
// ---------------------------------------------------------------------------
type TrackKind = 'stale' | 'fresh' | 'delivered_signed' | 'delivered_unsigned' | 'exception' | 'none';
interface DocSpec {
  kind: DocumentKind;
  amount?: number; // for invoices
  tracking?: string; // override (used to inject a mismatch)
  shipped?: number;
  received?: number;
  unsigned?: boolean;
}
interface ClaimSpec {
  clientId: number;
  carrierId: number;
  type: ClaimType;
  item: string;
  narrative: string;
  declared: number;
  insured: number;
  claimed: number;
  shipDaysAgo: number;
  filedDaysAgo: number;
  intl?: boolean;
  origin?: string;
  dest?: string;
  track: TrackKind;
  trackDaysAgo: number; // last scan / delivery, in days ago
  docs: DocSpec[];
  groundTruth: DecisionKind;
  gtNote: string;
  // When set, the claim has already been adjudicated (historical row + status).
  resolved?: {
    status: string;
    agentDecision: DecisionKind; // what the agent recorded (may differ from gt)
    paid?: number;
    confidence: number;
    decidedDaysAgo: number;
    reasoning: string;
    flags?: string[];
    escalationReason?: string;
    denialReason?: string;
  };
}

const buyerEmail = (n: number) => `buyer${n}@example.com`;

const CLAIMS: ClaimSpec[] = [
  // ---- OPEN claims (for live agent runs) ------------------------------
  {
    clientId: 1, carrierId: 2, type: 'loss',
    item: 'Titanium eyeglass frames (2 pairs)',
    narrative: 'Customer reports the package never arrived. Tracking went quiet at the regional sort hub.',
    declared: 240, insured: 240, claimed: 240, shipDaysAgo: 42, filedDaysAgo: 8,
    track: 'stale', trackDaysAgo: 30,
    docs: [{ kind: 'invoice', amount: 240 }, { kind: 'affidavit' }],
    groundTruth: 'approve', gtNote: 'Clean domestic loss; 30-day tracking gap exceeds the 21-day window. Full invoice value.',
  },
  {
    clientId: 5, carrierId: 3, type: 'damage',
    item: 'Carbon road bike frame',
    narrative: 'Frame arrived with a visible crack near the bottom bracket. Box was crushed on one corner.',
    declared: 1850, insured: 2000, claimed: 1850, shipDaysAgo: 26, filedDaysAgo: 6,
    track: 'exception', trackDaysAgo: 12,
    docs: [{ kind: 'invoice', amount: 1850 }, { kind: 'photo' }, { kind: 'photo' }],
    groundTruth: 'approve', gtNote: 'Transit damage with exception scan and clear photos. Pay repair/replacement at invoice value.',
  },
  {
    clientId: 8, carrierId: 1, type: 'shortage',
    item: 'Socket wrench set, 40 pieces (12 missing)',
    narrative: 'Carton arrived sealed but light. 12 of 40 sockets were missing from the tray.',
    declared: 210, insured: 210, claimed: 85, shipDaysAgo: 30, filedDaysAgo: 9,
    track: 'delivered_unsigned', trackDaysAgo: 11,
    docs: [{ kind: 'invoice', amount: 210 }, { kind: 'packing_slip', shipped: 40, received: 28 }, { kind: 'photo' }],
    groundTruth: 'approve', gtNote: 'Shortage substantiated by packing slip + photo. Pay missing-piece value ($85) less $35 deductible = $50.',
  },
  {
    clientId: 2, carrierId: 5, type: 'loss',
    item: 'Hand-poured soy candle set',
    narrative: 'Buyer says it never showed up. No affidavit was attached to the file.',
    declared: 120, insured: 120, claimed: 120, shipDaysAgo: 38, filedDaysAgo: 7,
    track: 'stale', trackDaysAgo: 31,
    docs: [{ kind: 'invoice', amount: 120 }],
    groundTruth: 'request_docs', gtNote: 'Loss looks genuine (31-day gap past the 28-day window) but the required consignee affidavit is missing — request it.',
  },
  {
    clientId: 6, carrierId: 2, type: 'damage',
    item: 'Studio monitor speakers (pair)',
    narrative: 'Customer claims one driver was damaged in transit but uploaded no photos.',
    declared: 680, insured: 700, claimed: 680, shipDaysAgo: 20, filedDaysAgo: 5,
    track: 'exception', trackDaysAgo: 9,
    docs: [{ kind: 'invoice', amount: 680 }],
    groundTruth: 'request_docs', gtNote: 'Damage claim cannot be assessed without photos of the damage — request them.',
  },
  {
    clientId: 4, carrierId: 1, type: 'loss',
    item: 'Large ceramic planter',
    narrative: 'Filed well after the account filing window had closed.',
    declared: 95, insured: 95, claimed: 95, shipDaysAgo: 80, filedDaysAgo: 10,
    track: 'stale', trackDaysAgo: 60,
    docs: [{ kind: 'invoice', amount: 95 }, { kind: 'affidavit' }],
    groundTruth: 'deny', gtNote: 'Filed 70 days after ship date; this account\'s window is 60 days. Late filing.',
  },
  {
    clientId: 2, carrierId: 3, type: 'loss',
    item: 'Wool throw blanket',
    narrative: 'Buyer claims non-receipt, but the carrier shows a signed delivery.',
    declared: 140, insured: 140, claimed: 140, shipDaysAgo: 30, filedDaysAgo: 6,
    track: 'delivered_signed', trackDaysAgo: 14,
    docs: [{ kind: 'invoice', amount: 140 }, { kind: 'affidavit' }],
    groundTruth: 'deny', gtNote: 'Delivery scan captured with a signature defeats the non-receipt claim.',
  },
  {
    clientId: 1, carrierId: 4, type: 'loss',
    item: 'Loose 1.2ct diamond, unset (GIA certified)',
    narrative: 'A single unset stone shipped on its own, reported lost in international transit.',
    declared: 4200, insured: 5000, claimed: 4200, shipDaysAgo: 50, filedDaysAgo: 10, intl: true,
    track: 'stale', trackDaysAgo: 44, dest: 'M5V 2T6',
    docs: [{ kind: 'invoice', amount: 4200 }, { kind: 'affidavit' }],
    groundTruth: 'deny', gtNote: 'Loose, unset precious gemstone — excluded commodity. Deny regardless of documentation.',
  },
  {
    clientId: 8, carrierId: 2, type: 'loss',
    item: 'Envelope of US $20 bills (cash float)',
    narrative: 'Shipper sent cash to a satellite location; reported lost.',
    declared: 600, insured: 600, claimed: 600, shipDaysAgo: 25, filedDaysAgo: 6,
    track: 'stale', trackDaysAgo: 22,
    docs: [{ kind: 'affidavit' }],
    groundTruth: 'deny', gtNote: 'Currency at face value is an excluded commodity. Deny.',
  },
  {
    clientId: 7, carrierId: 4, type: 'loss',
    item: 'Hand-knotted Persian rug, 8x10',
    narrative: 'High-value rug reported lost on an international lane after the waiting period.',
    declared: 14200, insured: 15000, claimed: 14200, shipDaysAgo: 55, filedDaysAgo: 12, intl: true,
    track: 'stale', trackDaysAgo: 47, dest: 'EC1A 1BB',
    docs: [{ kind: 'invoice', amount: 14200 }, { kind: 'affidavit' }],
    groundTruth: 'escalate', gtNote: 'Documentation is clean but the value is material and the lane is international — mandatory human sign-off.',
  },
  {
    clientId: 3, carrierId: 1, type: 'loss',
    item: 'Insulated trail jacket',
    narrative: 'Filed quickly; the parcel is still producing fresh transit scans.',
    declared: 260, insured: 260, claimed: 260, shipDaysAgo: 18, filedDaysAgo: 4,
    track: 'fresh', trackDaysAgo: 4,
    docs: [{ kind: 'invoice', amount: 260 }, { kind: 'affidavit' }],
    groundTruth: 'escalate', gtNote: 'Premature: parcel scanned 4 days ago, well inside the waiting period. Hold for human review rather than pay or deny.',
  },
  {
    clientId: 3, carrierId: 5, type: 'damage',
    item: 'Aluminum camp cookset',
    narrative: 'Damage claim, but the invoice tracking number does not match the claim tracking number.',
    declared: 180, insured: 200, claimed: 180, shipDaysAgo: 22, filedDaysAgo: 7,
    track: 'exception', trackDaysAgo: 10,
    docs: [{ kind: 'invoice', amount: 180, tracking: 'MISMATCH-9911-XX' }, { kind: 'photo' }],
    groundTruth: 'escalate', gtNote: 'Invoice tracking number does not tie to the claim — possible mismatched/borrowed invoice. Escalate for review.',
  },

  // ---- RESOLVED claims (historical) ------------------------------------
  {
    clientId: 1, carrierId: 2, type: 'loss',
    item: 'Polarized sunglasses (3 units)',
    narrative: 'Domestic loss, clean documentation, tracking gap past the window.',
    declared: 330, insured: 330, claimed: 330, shipDaysAgo: 48, filedDaysAgo: 18,
    track: 'stale', trackDaysAgo: 29,
    docs: [{ kind: 'invoice', amount: 330 }, { kind: 'affidavit' }],
    groundTruth: 'approve', gtNote: 'Approved at full invoice value.',
    resolved: { status: 'approved', agentDecision: 'approve', paid: 330, confidence: 0.93, decidedDaysAgo: 11, reasoning: 'Stale tracking past window + matching invoice + affidavit. Approve at invoice value.' },
  },
  {
    clientId: 5, carrierId: 3, type: 'damage',
    item: 'Treadmill drive motor',
    narrative: 'Arrived with a sheared mount; exception scan on file.',
    declared: 540, insured: 600, claimed: 540, shipDaysAgo: 33, filedDaysAgo: 14,
    track: 'exception', trackDaysAgo: 16,
    docs: [{ kind: 'invoice', amount: 540 }, { kind: 'photo' }, { kind: 'photo' }],
    groundTruth: 'approve', gtNote: 'Approved for replacement value.',
    resolved: { status: 'approved', agentDecision: 'approve', paid: 540, confidence: 0.9, decidedDaysAgo: 9, reasoning: 'Exception scan + damage photos establish transit causation. Approve replacement value.' },
  },
  {
    clientId: 8, carrierId: 1, type: 'shortage',
    item: 'Drill bit set (5 of 30 missing)',
    narrative: 'Short carton; packing slip confirms the shortfall.',
    declared: 150, insured: 150, claimed: 60, shipDaysAgo: 34, filedDaysAgo: 15,
    track: 'delivered_unsigned', trackDaysAgo: 17,
    docs: [{ kind: 'invoice', amount: 150 }, { kind: 'packing_slip', shipped: 30, received: 25 }, { kind: 'photo' }],
    groundTruth: 'approve', gtNote: 'Paid missing-piece value less deductible.',
    resolved: { status: 'approved', agentDecision: 'approve', paid: 25, confidence: 0.88, decidedDaysAgo: 8, reasoning: 'Shortage of 5 units substantiated. Pay $60 less $35 deductible = $25.' },
  },
  {
    clientId: 2, carrierId: 5, type: 'loss',
    item: 'Linen napkin set',
    narrative: 'Signed delivery contradicts the non-receipt claim.',
    declared: 70, insured: 70, claimed: 70, shipDaysAgo: 31, filedDaysAgo: 13,
    track: 'delivered_signed', trackDaysAgo: 15,
    docs: [{ kind: 'invoice', amount: 70 }, { kind: 'affidavit' }],
    groundTruth: 'deny', gtNote: 'Denied — signed delivery.',
    resolved: { status: 'denied', agentDecision: 'deny', confidence: 0.91, decidedDaysAgo: 7, reasoning: 'Signed delivery scan is strong evidence of receipt. Deny.', denialReason: 'Delivered with signature on file.' },
  },
  {
    clientId: 1, carrierId: 4, type: 'loss',
    item: 'Loose sapphire pair (unset)',
    narrative: 'Two unset stones reported lost.',
    declared: 2600, insured: 3000, claimed: 2600, shipDaysAgo: 46, filedDaysAgo: 16, intl: true,
    track: 'stale', trackDaysAgo: 40, dest: 'M5V 2T6',
    docs: [{ kind: 'invoice', amount: 2600 }, { kind: 'affidavit' }],
    groundTruth: 'deny', gtNote: 'Excluded loose gemstone.',
    resolved: { status: 'denied', agentDecision: 'deny', confidence: 0.95, decidedDaysAgo: 6, reasoning: 'Loose, unset precious stones — excluded commodity.', denialReason: 'Excluded commodity: loose precious gemstones.' },
  },
  {
    clientId: 4, carrierId: 1, type: 'loss',
    item: 'Stoneware mixing bowls',
    narrative: 'Filed long after the 60-day window.',
    declared: 88, insured: 88, claimed: 88, shipDaysAgo: 85, filedDaysAgo: 12,
    track: 'stale', trackDaysAgo: 64,
    docs: [{ kind: 'invoice', amount: 88 }, { kind: 'affidavit' }],
    groundTruth: 'deny', gtNote: 'Late filing.',
    resolved: { status: 'denied', agentDecision: 'deny', confidence: 0.97, decidedDaysAgo: 10, reasoning: 'Filed 73 days after ship; window is 60 days. Late file.', denialReason: 'Late filing — outside the 60-day window.' },
  },
  {
    clientId: 7, carrierId: 4, type: 'loss',
    item: 'Antique brass telescope',
    narrative: 'High-value international loss with clean docs.',
    declared: 9800, insured: 10000, claimed: 9800, shipDaysAgo: 58, filedDaysAgo: 19, intl: true,
    track: 'stale', trackDaysAgo: 49, dest: 'EC1A 1BB',
    docs: [{ kind: 'invoice', amount: 9800 }, { kind: 'affidavit' }],
    groundTruth: 'escalate', gtNote: 'Escalated for human sign-off on a five-figure international payout.',
    resolved: { status: 'escalated', agentDecision: 'escalate', confidence: 0.62, decidedDaysAgo: 9, reasoning: 'Documentation clean, but value is material and lane international. Escalate.', escalationReason: 'High-value international claim requires human sign-off.' },
  },
  {
    clientId: 6, carrierId: 2, type: 'damage',
    item: 'Bluetooth turntable',
    narrative: 'Damage reported without supporting photos.',
    declared: 320, insured: 350, claimed: 320, shipDaysAgo: 24, filedDaysAgo: 12,
    track: 'exception', trackDaysAgo: 13,
    docs: [{ kind: 'invoice', amount: 320 }],
    groundTruth: 'request_docs', gtNote: 'Requested damage photos.',
    resolved: { status: 'awaiting_docs', agentDecision: 'request_docs', confidence: 0.84, decidedDaysAgo: 5, reasoning: 'Cannot assess damage without photos. Request them.' },
  },
  {
    clientId: 2, carrierId: 3, type: 'loss',
    item: 'Beeswax food wrap bundle',
    narrative: 'Domestic loss, full documentation.',
    declared: 64, insured: 64, claimed: 64, shipDaysAgo: 39, filedDaysAgo: 17,
    track: 'stale', trackDaysAgo: 27,
    docs: [{ kind: 'invoice', amount: 64 }, { kind: 'affidavit' }],
    groundTruth: 'approve', gtNote: 'Approved less $25 deductible.',
    resolved: { status: 'approved', agentDecision: 'approve', paid: 39, confidence: 0.9, decidedDaysAgo: 8, reasoning: 'Clean domestic loss past the window. Pay $64 less $25 deductible = $39.' },
  },
  {
    clientId: 5, carrierId: 2, type: 'damage',
    item: 'Climbing helmet (cracked shell)',
    narrative: 'Cracked on arrival; exception scan + photos.',
    declared: 130, insured: 150, claimed: 130, shipDaysAgo: 28, filedDaysAgo: 13,
    track: 'exception', trackDaysAgo: 15,
    docs: [{ kind: 'invoice', amount: 130 }, { kind: 'photo' }],
    groundTruth: 'approve', gtNote: 'Approved replacement value.',
    resolved: { status: 'approved', agentDecision: 'approve', paid: 130, confidence: 0.92, decidedDaysAgo: 7, reasoning: 'Exception + photos establish transit damage. Approve.' },
  },
  {
    clientId: 3, carrierId: 1, type: 'loss',
    item: 'Merino base-layer set',
    narrative: 'Domestic loss, clean.',
    declared: 175, insured: 175, claimed: 175, shipDaysAgo: 37, filedDaysAgo: 16,
    track: 'stale', trackDaysAgo: 30,
    docs: [{ kind: 'invoice', amount: 175 }, { kind: 'affidavit' }],
    groundTruth: 'approve', gtNote: 'Approved full value (enterprise, no deductible).',
    resolved: { status: 'approved', agentDecision: 'approve', paid: 175, confidence: 0.93, decidedDaysAgo: 6, reasoning: 'Stale tracking past window + full docs. Approve at value.' },
  },
  {
    clientId: 6, carrierId: 3, type: 'shortage',
    item: 'Vinyl record box (3 of 10 missing)',
    narrative: 'Short box; photos + packing slip.',
    declared: 300, insured: 300, claimed: 90, shipDaysAgo: 32, filedDaysAgo: 15,
    track: 'delivered_unsigned', trackDaysAgo: 18,
    docs: [{ kind: 'invoice', amount: 300 }, { kind: 'packing_slip', shipped: 10, received: 7 }, { kind: 'photo' }],
    groundTruth: 'approve', gtNote: 'Paid missing-item value (no deductible).',
    resolved: { status: 'approved', agentDecision: 'approve', paid: 90, confidence: 0.89, decidedDaysAgo: 5, reasoning: 'Shortage of 3 units substantiated. Pay $90.' },
  },

  // ---- RESOLVED claims where the AGENT and the HUMAN diverged ----------
  {
    clientId: 2, carrierId: 2, type: 'loss',
    item: 'Ceramic mug set',
    narrative: 'Delivered without a signature; buyer filed a porch-theft affidavit.',
    declared: 70, insured: 70, claimed: 70, shipDaysAgo: 27, filedDaysAgo: 12,
    track: 'delivered_unsigned', trackDaysAgo: 13,
    docs: [{ kind: 'invoice', amount: 70 }, { kind: 'affidavit' }],
    groundTruth: 'approve',
    gtNote: 'Adjudicator accepted the porch-theft affidavit (unsigned delivery) and approved. The agent had escalated — a conservative miss.',
    resolved: { status: 'approved', agentDecision: 'escalate', confidence: 0.58, decidedDaysAgo: 4, reasoning: 'Delivered scan with no signature + affidavit. Porch theft is plausible but not certain — escalate for human judgment.', escalationReason: 'Delivered-but-not-received (no signature). Affidavit on file; needs human call.' },
  },
  {
    clientId: 5, carrierId: 3, type: 'damage',
    item: 'Full-suspension MTB frameset',
    narrative: 'Borderline-value damage just under the auto-escalate threshold.',
    declared: 7800, insured: 8000, claimed: 7800, shipDaysAgo: 29, filedDaysAgo: 14,
    track: 'exception', trackDaysAgo: 15,
    docs: [{ kind: 'invoice', amount: 7800 }, { kind: 'photo' }, { kind: 'photo' }],
    groundTruth: 'escalate',
    gtNote: 'Manager flagged this for human sign-off given the dollar value. The agent had approved it outright — an over-eager miss near the threshold.',
    resolved: { status: 'escalated', agentDecision: 'approve', paid: 7800, confidence: 0.86, decidedDaysAgo: 3, reasoning: 'Exception scan + clear photos. Value under the escalation threshold. Approve at invoice value.' },
  },
];

// ---------------------------------------------------------------------------
// Tracking event builder
// ---------------------------------------------------------------------------
const ORIGIN_CITIES = ['Reno, NV', 'Columbus, OH', 'Denver, CO', 'Newark, NJ', 'Atlanta, GA'];
const HUB_CITIES = ['Salt Lake City, UT', 'Memphis, TN', 'Kansas City, MO', 'Louisville, KY'];

function buildTracking(spec: ClaimSpec): { ts: string; status: string; location: string }[] {
  if (spec.track === 'none') return [];
  const out: { ts: string; status: string; location: string }[] = [];
  const origin = ORIGIN_CITIES[spec.carrierId % ORIGIN_CITIES.length];
  const hub = HUB_CITIES[spec.clientId % HUB_CITIES.length];
  out.push({ ts: timeISO(spec.shipDaysAgo + 1, 8), status: 'Shipping label created', location: origin });
  out.push({ ts: timeISO(spec.shipDaysAgo, 14), status: 'Picked up', location: origin });
  out.push({ ts: timeISO(Math.max(spec.shipDaysAgo - 2, spec.trackDaysAgo + 2), 3), status: 'Arrived at carrier facility', location: hub });

  if (spec.track === 'delivered_signed') {
    out.push({ ts: timeISO(spec.trackDaysAgo + 1, 7), status: 'Out for delivery', location: spec.dest ?? 'Destination city' });
    out.push({ ts: timeISO(spec.trackDaysAgo, 13), status: 'Delivered — signed by recipient', location: spec.dest ?? 'Destination city' });
  } else if (spec.track === 'delivered_unsigned') {
    out.push({ ts: timeISO(spec.trackDaysAgo + 1, 7), status: 'Out for delivery', location: spec.dest ?? 'Destination city' });
    out.push({ ts: timeISO(spec.trackDaysAgo, 13), status: 'Delivered — left at front door', location: spec.dest ?? 'Destination city' });
  } else if (spec.track === 'exception') {
    out.push({ ts: timeISO(spec.trackDaysAgo, 11), status: 'Delivery exception — package reported damaged', location: hub });
  } else {
    // stale / fresh: last scan is an "in transit / no movement" at trackDaysAgo
    out.push({
      ts: timeISO(spec.trackDaysAgo, 9),
      status: spec.track === 'fresh' ? 'In transit' : 'In transit — no recent movement',
      location: hub,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------
function trackingNumber(spec: ClaimSpec, id: number): string {
  const carrier = CARRIERS.find((c) => c.id === spec.carrierId)!;
  return `${carrier.code.slice(0, 2)}${(9_000_000_000 + id * 37).toString()}US`;
}

export function seedDatabase(db: SqlDb = getDb()): void {
  db.tx(() => {
    for (const c of CARRIERS) {
      db.run('INSERT INTO couriers (courier_id, courier_code, courier_name, swatch, transit_loss_threshold_days) VALUES (?,?,?,?,?)', [
        c.id, c.code, c.name, c.color, c.presumed,
      ]);
    }
    for (const cl of CLIENTS) {
      db.run(
        'INSERT INTO merchants (merchant_id, merchant_name, service_tier, dom_hold_days, intl_hold_days, file_window_days, allows_early_file, ops_note, deductible_usd) VALUES (?,?,?,?,?,?,?,?,?)',
        [cl.id, cl.name, cl.tier, cl.dom, cl.intl, cl.maxFile, cl.early, cl.note, cl.deductible],
      );
    }
    for (const d of DOC_TYPES) {
      db.run('INSERT INTO evidence_types (evidence_type_id, evidence_code, evidence_label) VALUES (?,?,?)', [d.id, d.code, d.label]);
    }

    CLAIMS.forEach((spec, i) => {
      const id = i + 1;
      const client = CLIENTS.find((c) => c.id === spec.clientId)!;
      const tn = trackingNumber(spec, id);
      const publicRef = `AEG-2026-${String(1000 + id).padStart(6, '0')}`;
      const status = spec.resolved ? spec.resolved.status : id <= 8 ? 'new' : 'in_review';
      const createdAt = timeISO(spec.filedDaysAgo, 9);
      const updatedAt = spec.resolved ? timeISO(spec.resolved.decidedDaysAgo, 16) : createdAt;

      db.run(
        `INSERT INTO cases
          (case_id, case_ref, merchant_id, courier_id, peril, lifecycle_state, goods_description, claimant_statement,
           declared_usd, coverage_limit_usd, demand_usd, shipment_ref, dispatched_on, filed_on,
           origin_postal, dest_postal, cross_border, claimant_contact, truth_label, truth_label_note,
           opened_at, touched_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, publicRef, spec.clientId, spec.carrierId, spec.type, status, spec.item, spec.narrative,
          spec.declared, spec.insured, spec.claimed, tn, dayISO(spec.shipDaysAgo), dayISO(spec.filedDaysAgo),
          spec.origin ?? '89501', spec.dest ?? '97201', spec.intl ? 1 : 0, buyerEmail(id),
          spec.groundTruth, spec.gtNote, createdAt, updatedAt,
        ],
      );

      // Documents
      let photoN = 0;
      spec.docs.forEach((doc) => {
        let text: string | null = null;
        let filename = '';
        let mime = 'text/plain';
        const docTracking = doc.tracking ?? tn;
        if (doc.kind === 'invoice') {
          text = invoiceText(spec.item, doc.amount ?? spec.claimed, docTracking, client.name);
          filename = `invoice_${publicRef}.txt`;
        } else if (doc.kind === 'affidavit') {
          text = affidavitText(`Customer ${id}`, spec.item);
          filename = `affidavit_${publicRef}.txt`;
        } else if (doc.kind === 'packing_slip') {
          text = packingSlipText(spec.item, doc.shipped ?? 0, doc.received ?? 0);
          filename = `packing_slip_${publicRef}.txt`;
        } else if (doc.kind === 'carrier_response') {
          text = carrierResponseText(docTracking, 'No trace located at the last-scan facility.');
          filename = `carrier_response_${publicRef}.txt`;
        } else if (doc.kind === 'photo') {
          photoN += 1;
          filename = `damage_${publicRef}_${photoN}.jpg`;
          mime = 'image/jpeg';
        } else if (doc.kind === 'tracking_screenshot') {
          filename = `tracking_${publicRef}.png`;
          mime = 'image/png';
        }
        db.run(
          `INSERT INTO evidence_items (case_id, evidence_kind, file_name, media_type, ocr_text, is_extracted, captured_at)
           VALUES (?,?,?,?,?,?,?)`,
          [id, doc.kind, filename, mime, text, 0, timeISO(spec.filedDaysAgo, 9)],
        );
      });

      // Tracking
      for (const ev of buildTracking(spec)) {
        db.run('INSERT INTO scan_history (case_id, scanned_at, scan_status, scan_locale) VALUES (?,?,?,?)', [
          id, ev.ts, ev.status, ev.location,
        ]);
      }

      // Historical decision + audit row
      if (spec.resolved) {
        const r = spec.resolved;
        db.run(
          `INSERT INTO adjudications
            (case_id, verdict, resulting_state, certainty, award_usd, refusal_basis,
             requested_evidence, referral_basis, rationale, signals, retrieved, gate_checks, guardrails,
             engine, engine_is_live, prompt_tokens, completion_tokens, elapsed_ms, ruled_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, r.agentDecision, r.status, r.confidence, r.paid ?? null, r.denialReason ?? null,
            '[]', r.escalationReason ?? null, r.reasoning, JSON.stringify(r.flags ?? []), '[]', '[]', '[]',
            'seed/historical', 0, 0, 0, 1200 + ((id * 137) % 900), timeISO(r.decidedDaysAgo, 16),
          ],
        );
        db.run(
          `INSERT INTO case_ledger (case_id, actor, from_state, to_state, memo, logged_at)
           VALUES (?,?,?,?,?,?)`,
          [id, 'agent', 'new', r.status, `Agent recorded: ${r.agentDecision}`, timeISO(r.decidedDaysAgo, 16)],
        );
      }
    });

    // Knowledge base (embeddings filled lazily on first boot by the vector store)
    for (const k of KNOWLEDGE) {
      db.run('INSERT INTO policy_chunks (chunk_kind, heading, body, citation, vector) VALUES (?,?,?,?,NULL)', [
        k.category, k.title, k.text, k.source,
      ]);
    }
  });
}

const DROP_ORDER = [
  'case_ledger', 'adjudications', 'eval_runs', 'scan_history',
  'evidence_items', 'policy_chunks', 'cases', 'evidence_types', 'merchants', 'couriers',
];

export function resetAndSeed(db: SqlDb = getDb()): void {
  for (const t of DROP_ORDER) db.exec(`DROP TABLE IF EXISTS ${t};`);
  migrate(db);
  seedDatabase(db);
}

export function seedIfEmpty(db: SqlDb = getDb()): boolean {
  migrate(db);
  const row = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cases');
  if ((row?.n ?? 0) > 0) return false;
  seedDatabase(db);
  return true;
}

// CLI: `npm run seed` passes --reset to rebuild from scratch. Importing this
// module (e.g. for seedIfEmpty during boot) never triggers a reset.
if (process.argv.includes('--reset')) {
  const db = getDb();
  resetAndSeed(db);
  const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cases')!;
  const k = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM policy_chunks')!;
  // eslint-disable-next-line no-console
  console.log(`✓ Seeded ${n.n} claims and ${k.n} knowledge chunks into ${db.driverName}.`);
}
