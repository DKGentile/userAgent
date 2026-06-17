/**
 * Assembles the full context the decision agent reasons over — the claim, its
 * client SOP parameters, carrier, documents, tracking, and a set of derived
 * signals (exclusions, missing documents, invoice/tracking reconciliation).
 * Mirrors the "assemble everything, then decide" shape of the production agent.
 */
import { getClaim, getClient, listCarriers, listDocTypes } from '../../db/repos.js';
import { resolveTracking, deliveredWithSignature } from '../tracking.js';
import type {
  Carrier,
  ClaimWithRefs,
  Client,
  DocAnalysis,
  DocumentKind,
  TrackingStatus,
} from '@shared';

export interface AgentContext {
  claim: ClaimWithRefs;
  client: Client;
  carrier: Carrier;
  tracking: TrackingStatus;
  signatureOnDelivery: boolean;
  daysFiledAfterShip: number;
  waitingDays: number;

  // exclusion / eligibility signals (do not need document analysis)
  excluded: { reason: string } | null;
  restrictedZip: { zip: string } | null;

  // filled in after the documents stage
  analyses: DocAnalysis[];
  presentKinds: Set<DocumentKind>;
  invoiceAmount: number | null;
  requiredDocTypeIds: number[];
  missingDocTypeIds: number[];
  missingDocLabels: string[];
  trackingMismatch: { docTracking: string } | null;
}

const RESTRICTED_ZIPS = new Set(['10044', '90089']);
const JEWELRY_RE = /\b(jewel|jewelry|necklace|bracelet|ring|earring|coin|coins)\b/i;

function daysBetween(aISO: string, bISO: string): number {
  return Math.round((new Date(bISO).getTime() - new Date(aISO).getTime()) / 86_400_000);
}

function detectExclusion(item: string): { reason: string } | null {
  const s = item.toLowerCase();
  const looseGem =
    /\b(loose|unset)\b/.test(s) && /\b(diamond|sapphire|ruby|emerald|gem|gemstone|stone)\b/.test(s);
  if (looseGem) return { reason: 'Loose / unset precious gemstone — excluded commodity (Handbook §4.2).' };
  if (/\b(cash|currency|bullion|bank ?notes?)\b/.test(s) || /\$\s?\d+\s*bills?\b/.test(s) || /\bbills?\b/.test(s)) {
    return { reason: 'Currency / negotiable instrument at face value — excluded commodity (Handbook §4.1).' };
  }
  if (/\b(perishable|cut flowers|fresh flowers|live plant|fresh produce)\b/.test(s)) {
    return { reason: 'Perishable goods — excluded commodity (Handbook §4.3).' };
  }
  return null;
}

export function normalizeTracking(t: string | null | undefined): string {
  if (!t) return '';
  let s = String(t).replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/^\d+$/.test(s) && s.length >= 30) s = s.slice(8); // strip routing prefix
  return s;
}

export function requiredDocsForType(type: string): number[] {
  // ids: 1 invoice, 2 photo, 3 affidavit, 5 packing_slip
  if (type === 'loss') return [1, 3];
  if (type === 'damage') return [1, 2];
  if (type === 'shortage') return [1, 2]; // invoice + (photo OR packing slip; handled below)
  return [1];
}

export function assembleBaseContext(claimId: number): AgentContext | null {
  const claim = getClaim(claimId);
  if (!claim) return null;
  const client = getClient(claim.clientId)!;
  const carrier = listCarriers().find((c) => c.id === claim.carrierId)!;
  const tracking = resolveTracking({ ...claim, carrierCode: claim.carrierCode });

  const waitingDays = claim.isInternational ? client.intlWaitingDays : client.domesticWaitingDays;
  const restricted =
    JEWELRY_RE.test(claim.itemDescription) &&
    (RESTRICTED_ZIPS.has(claim.originZip) || RESTRICTED_ZIPS.has(claim.destZip))
      ? { zip: RESTRICTED_ZIPS.has(claim.destZip) ? claim.destZip : claim.originZip }
      : null;

  return {
    claim,
    client,
    carrier,
    tracking,
    signatureOnDelivery: deliveredWithSignature(tracking),
    daysFiledAfterShip: daysBetween(claim.shipDate, claim.filedDate),
    waitingDays,
    excluded: detectExclusion(claim.itemDescription),
    restrictedZip: restricted,
    analyses: [],
    presentKinds: new Set(),
    invoiceAmount: null,
    requiredDocTypeIds: requiredDocsForType(claim.type),
    missingDocTypeIds: [],
    missingDocLabels: [],
    trackingMismatch: null,
  };
}

/** Refine the context once documents have been analyzed. */
export function applyAnalyses(ctx: AgentContext, analyses: DocAnalysis[]): void {
  ctx.analyses = analyses;
  ctx.presentKinds = new Set(analyses.map((a) => a.detectedDocType));

  // Invoice amount: prefer an invoice whose tracking ties to the claim.
  const claimTrack = normalizeTracking(ctx.claim.trackingNumber);
  const invoices = analyses.filter((a) => a.detectedDocType === 'invoice' && a.amount != null);
  const anchored = invoices.find((a) => {
    const dt = normalizeTracking(a.tracking);
    return dt && (dt === claimTrack || dt.includes(claimTrack) || claimTrack.includes(dt));
  });
  ctx.invoiceAmount = anchored?.amount ?? (invoices.length ? Math.max(...invoices.map((a) => a.amount!)) : null);

  // Tracking reconciliation: a mismatch only matters when NO document ties to
  // the claim tracking number (otherwise extra docs are merely supplementary).
  const hasAnchor = analyses.some((a) => {
    const dt = normalizeTracking(a.tracking);
    return dt && (dt === claimTrack || dt.includes(claimTrack) || claimTrack.includes(dt));
  });
  const stray = analyses.find((a) => {
    const dt = normalizeTracking(a.tracking);
    return dt && !(dt === claimTrack || dt.includes(claimTrack) || claimTrack.includes(dt));
  });
  ctx.trackingMismatch = !hasAnchor && stray && stray.tracking ? { docTracking: stray.tracking } : null;

  // Missing required documents
  const docTypes = listDocTypes();
  const label = (id: number) => docTypes.find((d) => d.id === id)?.label ?? `Doc ${id}`;
  const missing: number[] = [];
  const has = (id: number) => {
    const code = docTypes.find((d) => d.id === id)?.code;
    return code ? ctx.presentKinds.has(code as DocumentKind) : false;
  };
  if (!has(1)) missing.push(1); // invoice always required
  if (ctx.claim.type === 'loss' && !has(3)) missing.push(3); // affidavit
  if (ctx.claim.type === 'damage' && !has(2)) missing.push(2); // photos
  if (ctx.claim.type === 'shortage' && !has(2) && !has(5)) missing.push(2); // photo or packing slip
  ctx.missingDocTypeIds = missing;
  ctx.missingDocLabels = missing.map(label);
}
