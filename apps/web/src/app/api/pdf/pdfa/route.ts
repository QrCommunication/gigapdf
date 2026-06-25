/**
 * PDF/A + PDF/UA (accessible, tagged) conversion route via the WASM engine.
 *
 * POST /api/pdf/pdfa
 *
 * Form fields (multipart/form-data):
 *   file        — PDF file (required)
 *   variant     — one of the 6 PDF/A conformance levels (default "pdfa-2u"):
 *                   "pdfa-1b"  ISO 19005-1 (PDF 1.4), visual fidelity only
 *                   "pdfa-1a"  ISO 19005-1 level A — Tagged (structure tree + /Lang)
 *                   "pdfa-2b"  ISO 19005-2 (PDF 1.7)
 *                   "pdfa-2u"  like 2b, every glyph Unicode-mapped (/ToUnicode)
 *                   "pdfa-2a"  ISO 19005-2 level A — Tagged
 *                   "pdfa-3b"  ISO 19005-3 — permits embedded file attachments
 *   pdfUa       — "true"/"1" → produce a Tagged accessible PDF stamped PDF/UA-1
 *                 (ISO 14289) instead of PDF/A. Supersedes `variant` when set.
 *   figureAlts  — optional JSON array of strings: author-supplied alternate text
 *                 per document-global figure index (figure 0, 1, 2…). Applied to
 *                 the `/Figure` structure elements of the tagged output (level-A
 *                 variants or PDF/UA); ignored for visual-only level-B variants.
 *
 * Returns the converted PDF as application/pdf, or 400/422 on bad input /
 * unconvertible source.
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because the 6-level + tagged/UA + figure-alt surface is exposed by
 * GigaPdfDoc; @qrcommunication/gigapdf-lib is a server-external package whose
 * `gigapdf.wasm` is traced for `/api/pdf/**` (see next.config.ts).
 */

import { NextResponse } from 'next/server';
import { GigaPdfEngine, type GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

type PdfAVariant =
  | 'pdfa-1b'
  | 'pdfa-1a'
  | 'pdfa-2b'
  | 'pdfa-2u'
  | 'pdfa-2a'
  | 'pdfa-3b';

const VALID_VARIANTS: PdfAVariant[] = [
  'pdfa-1b',
  'pdfa-1a',
  'pdfa-2b',
  'pdfa-2u',
  'pdfa-2a',
  'pdfa-3b',
];

/**
 * The Rust→WASM engine, instantiated once and shared across requests. Mirrors
 * the singleton in @giga-pdf/pdf-engine — `loadDefault()` reads the self-
 * contained `gigapdf.wasm` from disk (no third-party PDF libraries).
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;
function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}

/** Parse the optional `figureAlts` JSON array; `null` signals a malformed value. */
function parseFigureAlts(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => (typeof v === 'string' ? v : String(v ?? '')));
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const variant = ((formData.get('variant') as string | null) ?? 'pdfa-2u') as PdfAVariant;
    if (!VALID_VARIANTS.includes(variant)) {
      return NextResponse.json(
        { success: false, error: `variant must be one of: ${VALID_VARIANTS.join(', ')}.` },
        { status: 400 },
      );
    }

    const pdfUaRaw = formData.get('pdfUa');
    const pdfUa = pdfUaRaw === 'true' || pdfUaRaw === '1';

    const figureAlts = parseFigureAlts(formData.get('figureAlts'));
    if (figureAlts === null) {
      return NextResponse.json(
        { success: false, error: 'figureAlts must be a JSON array of strings.' },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      // Author-supplied alt text lands on the /Figure structure elements of a
      // tagged output (level-A or PDF/UA). Bound by figureCount(); empty entries
      // keep the engine's generic placeholder. No-op for visual-only variants.
      if (figureAlts.length > 0) {
        const figureCount = doc.figureCount();
        const upTo = Math.min(figureAlts.length, figureCount);
        for (let i = 0; i < upTo; i++) {
          const alt = figureAlts[i]?.trim();
          if (alt) doc.setFigureAlt(i, alt);
        }
      }

      const result = pdfUa ? doc.toTagged({ pdfUa: true }) : doc.toPdfA(variant);

      const conformance = pdfUa ? 'pdf-ua-1' : variant;
      const suffix = pdfUa ? '.ua.pdf' : '.pdfa.pdf';
      const renamed = file.name.replace(/\.pdf$/i, '') + suffix;

      return new Response(Buffer.from(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(renamed),
          'Content-Length': String(result.byteLength),
          'X-PDF-A-Variant': pdfUa ? 'pdf-ua' : variant,
          'X-PDF-Conformance': conformance,
        },
      });
    } catch (engineError: unknown) {
      // The input is a validated, non-empty PDF at this point, so an engine
      // failure means a corrupt/unsupported source or a conversion the chosen
      // level cannot satisfy — a client-correctable 422, not a server fault.
      serverLogger.warn('api.pdf.pdfa.engine', { error: engineError, variant, pdfUa });
      return NextResponse.json(
        {
          success: false,
          error:
            'PDF/A conversion failed. The PDF may be corrupted or use features incompatible with the selected conformance level.',
        },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.pdfa', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'PDF/A conversion failed.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
