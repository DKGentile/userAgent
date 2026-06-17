/**
 * Aegis knowledge base — the corpus the RAG pipeline retrieves over.
 *
 * 100% ORIGINAL, FICTIONAL content authored for this demo. These are generic
 * shipping-insurance concepts written from scratch with invented section
 * numbers for a make-believe carrier ("Aegis"). No proprietary or real-world
 * policy text is reproduced here.
 */
import type { KnowledgeCategory } from '@shared';

export interface SeedChunk {
  category: KnowledgeCategory;
  title: string;
  text: string;
  source: string;
}

export const KNOWLEDGE: SeedChunk[] = [
  // ---- Coverage rules --------------------------------------------------
  {
    category: 'coverage_rule',
    title: 'Filing window',
    text: 'A claim must be filed within the client account\'s filing window measured from the ship date. Standard accounts allow 90 days; some enterprise accounts extend to 120 days. A claim filed after the window has closed is denied as a late filing and is not adjudicated on its merits.',
    source: 'Aegis Coverage Handbook §1.2',
  },
  {
    category: 'coverage_rule',
    title: 'Loss waiting period',
    text: 'A parcel is not presumed lost until it has gone without a carrier scan for the waiting period. Domestic shipments use a 15–21 day window depending on account tier; international shipments use 40–45 days. A loss claim filed before the waiting period has elapsed is premature: the parcel may still be moving, so the claim should be held or escalated rather than approved or denied.',
    source: 'Aegis Coverage Handbook §1.4',
  },
  {
    category: 'coverage_rule',
    title: 'Declared value and the coverage cap',
    text: 'Payouts are based on the documented invoice value of the lost or damaged goods, including tax and inbound shipping when those were part of the declared value. The payout is capped at the insured amount on the policy. Handling fees and the insurance premium itself are never reimbursable.',
    source: 'Aegis Coverage Handbook §2.1',
  },
  {
    category: 'coverage_rule',
    title: 'Deductibles',
    text: 'When a client account carries a per-claim deductible, it is subtracted from the otherwise-payable amount after the coverage cap is applied. If the deductible exceeds the payable amount the claim resolves to a zero payout but is still recorded as approved.',
    source: 'Aegis Coverage Handbook §2.3',
  },
  {
    category: 'coverage_rule',
    title: 'Partial loss and shortage valuation',
    text: 'For a shortage claim only the value of the missing items is payable, not the full shipment value. The claimant must substantiate the per-item value with an invoice or packing slip. A photograph of the delivered carton showing the shortfall strengthens the claim but does not by itself establish value.',
    source: 'Aegis Coverage Handbook §2.5',
  },
  {
    category: 'coverage_rule',
    title: 'Damage valuation',
    text: 'Damage is paid as the lesser of the repair cost or the depreciated replacement value of the affected items. If the damaged goods retain salvage value, that salvage is deducted from the payout. Clear photographs of the damage and the packaging are required to assess transit causation.',
    source: 'Aegis Coverage Handbook §2.6',
  },
  {
    category: 'coverage_rule',
    title: 'Required documentation by claim type',
    text: 'A loss claim requires a commercial invoice and a signed consignee affidavit attesting non-receipt. A damage claim requires a commercial invoice and photographs of the damaged goods. A shortage claim requires a commercial invoice plus either photographs of the opened carton or the packing slip. Missing required documents lead to a document request, never an outright denial.',
    source: 'Aegis Coverage Handbook §3.1',
  },
  {
    category: 'coverage_rule',
    title: 'Delivered-but-not-received (porch theft)',
    text: 'When tracking shows delivery but the consignee states the parcel never arrived, the claim hinges on the consignee affidavit. A credible affidavit plus a delivery scan with no signature can support payment for porch theft. A delivery scan captured with a signature is strong evidence of receipt and generally defeats a non-receipt claim.',
    source: 'Aegis Coverage Handbook §3.4',
  },
  {
    category: 'coverage_rule',
    title: 'International delivered-loss',
    text: 'For international shipments that scan as delivered, a subsequent claim of loss is treated with heightened scrutiny because cross-border delivery scans are less reliable. These claims are not auto-approved; they are escalated for human review when the documented value is material.',
    source: 'Aegis Coverage Handbook §3.6',
  },
  {
    category: 'coverage_rule',
    title: 'Concealed damage reporting',
    text: 'Damage discovered after delivery (concealed damage) must be reported within 5 business days of the delivery scan and supported by photographs of both the item and the original packaging. Reports filed after this window are weighed against the possibility of post-delivery handling.',
    source: 'Aegis Coverage Handbook §3.7',
  },

  // ---- Exclusions ------------------------------------------------------
  {
    category: 'exclusion',
    title: 'Currency and negotiable instruments',
    text: 'Cash, coins and currency carried at face value, bullion, bank notes, securities, gift cards and other negotiable instruments are excluded from coverage. Note the narrow scope: collectible currency insured for its numismatic (collector) value, rather than face value, is not excluded on these grounds.',
    source: 'Aegis Coverage Handbook §4.1 (Exclusions)',
  },
  {
    category: 'exclusion',
    title: 'Loose precious gemstones',
    text: 'Loose or unset precious and semi-precious stones — diamonds, rubies, emeralds, sapphires shipped on their own — are excluded. Importantly, gemstones SET into finished jewelry are NOT excluded under this clause, and costume pieces using cubic zirconia, synthetic stones, or plated metals remain fully covered.',
    source: 'Aegis Coverage Handbook §4.2 (Exclusions)',
  },
  {
    category: 'exclusion',
    title: 'Perishable goods',
    text: 'Perishable cargo with a shelf life under three years — fresh food, cut flowers, live plants, and similar — is excluded because spoilage cannot be distinguished from a covered transit peril. Shelf-stable goods such as packaged alcohol are not perishable for this purpose.',
    source: 'Aegis Coverage Handbook §4.3 (Exclusions)',
  },
  {
    category: 'exclusion',
    title: 'Original fine art',
    text: 'One-of-a-kind original artwork and antiques are excluded unless a written fine-art endorsement is attached to the account. Reproductions, prints, and mass-produced décor are covered as ordinary goods.',
    source: 'Aegis Coverage Handbook §4.4 (Exclusions)',
  },
  {
    category: 'exclusion',
    title: 'Insufficient packaging',
    text: 'Loss or damage caused by packaging that fails to meet the carrier\'s published requirements is excluded. The adjudicator should look for evidence in damage photos that the item was under-protected, crushed because of void fill, or shipped in a carton rated below the item weight.',
    source: 'Aegis Coverage Handbook §4.5 (Exclusions)',
  },
  {
    category: 'exclusion',
    title: 'Descriptive labeling',
    text: 'When the outer packaging openly advertises high-value contents (brand logos, "diamonds inside", electronics manufacturer boxes shipped without an overbox), losses attributable to that descriptive labeling are excluded as an invitation to theft.',
    source: 'Aegis Coverage Handbook §4.6 (Exclusions)',
  },
  {
    category: 'exclusion',
    title: 'Consignment and memorandum shipments',
    text: 'Goods shipped on consignment, memorandum, or approval terms are excluded because title and insurable interest are ambiguous in transit. A claim narrative describing goods "sent on memo" or "on approval" should trigger this exclusion.',
    source: 'Aegis Coverage Handbook §4.7 (Exclusions)',
  },
  {
    category: 'exclusion',
    title: 'Restricted destination ZIP codes',
    text: 'Shipments of jewelry or coins to or from designated high-fraud ZIP codes (currently 10044 and 90089 in the demo dataset) are not insured. This restriction applies only to jewelry and coin commodities, not to general merchandise moving through those ZIPs.',
    source: 'Aegis Coverage Handbook §4.9 (Exclusions)',
  },

  // ---- Procedures ------------------------------------------------------
  {
    category: 'procedure',
    title: 'Tracking contradicts the claim',
    text: 'Before deciding, reconcile the carrier tracking against the claim narrative. A delivered scan on a loss claim, or a fresh in-transit scan on a claim filed as lost, is a contradiction. Contradictions that cannot be resolved from the file are escalated rather than guessed.',
    source: 'Aegis Adjudication Procedure P-02',
  },
  {
    category: 'procedure',
    title: 'Fraud signals',
    text: 'Escalate, never auto-decide, when fraud signals are present: a claimant email or shipper previously flagged, a tracking number that does not appear on any manifest, repeated claims against the same address, or an invoice whose tracking number does not match the claim. Human review owns the final call on flagged claims.',
    source: 'Aegis Adjudication Procedure P-04',
  },
  {
    category: 'procedure',
    title: 'Confidence threshold and escalation',
    text: 'The agent must reach a minimum confidence before committing to approve, deny, or request documents. Below that threshold the claim is escalated. High documented value is itself a reason to escalate even when confidence is otherwise adequate, so a human signs off on large payouts.',
    source: 'Aegis Adjudication Procedure P-05',
  },
  {
    category: 'procedure',
    title: 'Document request workflow',
    text: 'When required documents are missing, request exactly the missing document types and set the claim to await documents — do not deny. Early-filed claims are processed on their merits or sent a document request; an early filing is never a denial reason on its own.',
    source: 'Aegis Adjudication Procedure P-06',
  },

  // ---- Precedents (invented prior adjudications) -----------------------
  {
    category: 'precedent',
    title: 'Precedent: domestic stale-tracking loss approved',
    text: 'A domestic loss claim whose tracking had no scan for 28 days (past the 21-day window), supported by a matching invoice and a consignee affidavit, was approved at the full invoice value. The clean documentation and a tracking gap exceeding the waiting period were decisive.',
    source: 'Aegis Precedent Ledger #4471',
  },
  {
    category: 'precedent',
    title: 'Precedent: damage approved minus salvage',
    text: 'A bicycle frame arriving with a cracked tube, evidenced by photos showing crush damage and an exception scan, was approved for the repair estimate less the salvage value of reusable components. Photographs establishing transit causation were required before payment.',
    source: 'Aegis Precedent Ledger #4519',
  },
  {
    category: 'precedent',
    title: 'Precedent: delivered-with-signature loss denied',
    text: 'A loss claim was denied where tracking showed delivery captured with a signature and the consignee provided no affidavit. The signed delivery scan was treated as strong evidence of receipt, defeating the non-receipt assertion.',
    source: 'Aegis Precedent Ledger #4602',
  },
  {
    category: 'precedent',
    title: 'Precedent: loose gemstone denied as excluded',
    text: 'A claim for a single unset 1.2-carat diamond shipped on its own was denied as an excluded loose precious stone. The adjudicator confirmed the stone was not set into finished jewelry before applying the exclusion.',
    source: 'Aegis Precedent Ledger #4655',
  },
  {
    category: 'precedent',
    title: 'Precedent: high-value international claim escalated',
    text: 'A five-figure international claim for a hand-knotted rug, though documented with an invoice and affidavit, was escalated rather than auto-approved. Material value combined with international delivery uncertainty triggered mandatory human sign-off.',
    source: 'Aegis Precedent Ledger #4710',
  },
  {
    category: 'precedent',
    title: 'Precedent: shortage partial payout',
    text: 'A 40-piece tool set arriving with 12 pieces missing was paid only for the 12 missing pieces, valued from the packing slip, less the account deductible. The intact remainder of the shipment was not reimbursed.',
    source: 'Aegis Precedent Ledger #4744',
  },
];
