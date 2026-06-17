/**
 * Document analysis. Extracts the invoice amount, tracking number, and a
 * document-type classification from each claim document.
 *
 *  - Text documents (invoices, affidavits, packing slips): a real Claude
 *    (Haiku) extraction when ANTHROPIC_API_KEY is present, otherwise a robust
 *    regex/heuristic parser. Either path is honest about which ran (usedModel).
 *  - Images (damage photos): classified by type. With a vision-capable key and
 *    real bytes this is where Claude vision would run; the demo ships synthetic
 *    photos with no pixels, so they are typed heuristically.
 */
import { Config } from '../config.js';
import { getAnthropic } from './llm.js';
import { getDocuments, saveDocumentAnalysis } from '../db/repos.js';
import type { ClaimDocument, DocAnalysis, DocumentKind } from '@shared';

const AMOUNT_RE = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
const TOTAL_RE = /total\s*(?:due|amount)?\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i;
const TRACK_RE = /(?:tracking|ship reference)[^:]*:\s*([A-Z0-9][A-Z0-9\-]{4,})/i;

function detectType(text: string, fallback: DocumentKind): DocumentKind {
  const t = text.toUpperCase();
  if (t.includes('AFFIDAVIT')) return 'affidavit';
  if (t.includes('PACKING SLIP')) return 'packing_slip';
  if (t.includes('CARRIER') && t.includes('RESPONSE')) return 'carrier_response';
  if (t.includes('INVOICE')) return 'invoice';
  return fallback;
}

function heuristicExtract(doc: ClaimDocument): DocAnalysis {
  if (!doc.textContent) {
    return {
      documentId: doc.id,
      filename: doc.filename,
      kind: doc.kind,
      detectedDocType: doc.kind,
      amount: null,
      tracking: null,
      confidence: 0.7,
      notes: 'Image document classified by type — no OCR text available in the demo dataset.',
      usedModel: false,
    };
  }
  const text = doc.textContent;
  const detected = detectType(text, doc.kind);

  let amount: number | null = null;
  const totalMatch = TOTAL_RE.exec(text);
  if (totalMatch) {
    amount = Number(totalMatch[1].replace(/,/g, ''));
  } else {
    const all = [...text.matchAll(AMOUNT_RE)].map((m) => Number(m[1].replace(/,/g, '')));
    if (all.length) amount = Math.max(...all);
  }
  if (detected !== 'invoice') amount = detected === 'packing_slip' ? amount : null;

  const trackMatch = TRACK_RE.exec(text);
  const tracking = trackMatch ? trackMatch[1].trim() : null;

  const confidence = detected === 'invoice' && amount ? 0.95 : detected === 'affidavit' ? 0.9 : 0.85;
  return {
    documentId: doc.id,
    filename: doc.filename,
    kind: doc.kind,
    detectedDocType: detected,
    amount,
    tracking,
    confidence,
    notes: `Heuristic text extraction (${detected}${amount ? `, $${amount}` : ''}${tracking ? `, ${tracking}` : ''}).`,
    usedModel: false,
  };
}

async function llmExtract(doc: ClaimDocument): Promise<DocAnalysis> {
  const client = getAnthropic();
  if (!client || !doc.textContent) return heuristicExtract(doc);
  try {
    const resp = await client.messages.create({
      model: Config.ANALYZER_MODEL,
      max_tokens: 400,
      tools: [
        {
          name: 'record_extraction',
          description: 'Record the structured fields extracted from a shipping-claim document.',
          input_schema: {
            type: 'object',
            properties: {
              doc_type: { type: 'string', enum: ['invoice', 'affidavit', 'packing_slip', 'carrier_response', 'photo', 'tracking_screenshot'] },
              amount: { type: ['number', 'null'], description: 'Total monetary amount on the document, if any.' },
              tracking: { type: ['string', 'null'], description: 'Tracking / shipment reference number, if any.' },
            },
            required: ['doc_type'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'record_extraction' },
      messages: [
        {
          role: 'user',
          content: `Extract the document type, total amount, and tracking number from this shipping-claim document:\n\n${doc.textContent}`,
        },
      ],
    });
    const tool = resp.content.find((b) => b.type === 'tool_use');
    if (tool && tool.type === 'tool_use') {
      const input = tool.input as { doc_type: DocumentKind; amount?: number | null; tracking?: string | null };
      return {
        documentId: doc.id,
        filename: doc.filename,
        kind: doc.kind,
        detectedDocType: input.doc_type ?? doc.kind,
        amount: input.amount ?? null,
        tracking: input.tracking ?? null,
        confidence: 0.97,
        notes: `Extracted via ${Config.ANALYZER_MODEL}.`,
        usedModel: true,
      };
    }
  } catch {
    /* fall through to heuristic */
  }
  return heuristicExtract(doc);
}

async function analyzeOne(doc: ClaimDocument): Promise<DocAnalysis> {
  // Reuse a prior analysis (keeps backtests cheap + deterministic).
  if (doc.analyzed) {
    return {
      documentId: doc.id,
      filename: doc.filename,
      kind: doc.kind,
      detectedDocType: (doc.extractedDocType as DocumentKind) ?? doc.kind,
      amount: doc.extractedAmount ?? null,
      tracking: doc.extractedTracking ?? null,
      confidence: doc.analysisConfidence ?? 0.8,
      notes: doc.analysisNotes ?? 'Previously analyzed.',
      usedModel: false,
    };
  }
  return getAnthropic() ? llmExtract(doc) : heuristicExtract(doc);
}

/** Analyze every document on a claim, persist the results, and return them. */
export async function analyzeClaimDocuments(claimId: number, persist = true): Promise<DocAnalysis[]> {
  const docs = getDocuments(claimId);
  const out: DocAnalysis[] = [];
  for (const doc of docs) {
    const a = await analyzeOne(doc);
    if (persist && !doc.analyzed) {
      saveDocumentAnalysis(doc.id, {
        amount: a.amount,
        tracking: a.tracking,
        docType: a.detectedDocType,
        confidence: a.confidence,
        notes: a.notes,
      });
    }
    out.push(a);
  }
  return out;
}
