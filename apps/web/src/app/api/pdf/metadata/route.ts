/**
 * PDF Metadata route
 *
 * POST /api/pdf/metadata
 * Get or set PDF document metadata: the `/Info` dictionary (title, author,
 * subject, keywords, …), the raw XMP `/Metadata` packet, and the catalog
 * display preferences (`/ViewerPreferences`, `/PageLayout`, `/PageMode`).
 *
 * Form fields (multipart/form-data):
 *   file              — PDF file (required)
 *   action            — "get" | "set" (required)
 *   metadata          — JSON DocumentMetadata subset (Info fields) — set only, optional
 *   xmp               — raw XMP packet (string)                    — set only, optional
 *   viewerPreferences — JSON ViewerPreferences object             — set only, optional
 *   pageLayout        — one of the PageLayout names                — set only, optional
 *   pageMode          — one of the PageMode names                  — set only, optional
 *
 * Info schema (subset of @giga-pdf/types):
 * {
 *   title?: string, author?: string, subject?: string, keywords?: string[],
 *   creator?: string, producer?: string
 * }
 *
 * "get" — returns JSON `{ success, data: { metadata, xmp } }` where `metadata`
 *         is the current DocumentMetadata and `xmp` is the raw XMP packet
 *         (UTF-8 string) or `null` when the document has none.
 * "set" — applies every supplied operation (Info → display prefs → XMP, in that
 *         order so a raw XMP packet overrides the synced Info fields) and returns
 *         the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  getMetadata,
  setMetadata,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import type { DocumentMetadata } from '@giga-pdf/types';
import type {
  ViewerPreferences,
  PageLayout,
  PageMode,
} from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// Catalog enumerations (ISO 32000-1 §7.7.2). Used to reject unknown names with
// a 400 before they reach the engine.
const PAGE_LAYOUTS = new Set<PageLayout>([
  'SinglePage',
  'OneColumn',
  'TwoColumnLeft',
  'TwoColumnRight',
  'TwoPageLeft',
  'TwoPageRight',
]);
const PAGE_MODES = new Set<PageMode>([
  'UseNone',
  'UseOutlines',
  'UseThumbs',
  'FullScreen',
  'UseOC',
  'UseAttachments',
]);

const VIEWER_PREFERENCE_BOOLEAN_KEYS = [
  'hideToolbar',
  'hideMenubar',
  'hideWindowUI',
  'fitWindow',
  'centerWindow',
  'displayDocTitle',
] as const;

// A full XMP packet is a few KB; cap the accepted payload defensively.
const MAX_XMP_BYTES = 1_000_000;

type InfoPatch = Partial<
  Pick<
    DocumentMetadata,
    'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'
  >
>;

/**
 * Sanitise an untrusted JSON value into a {@link ViewerPreferences} object,
 * keeping only the known boolean keys and a valid `direction`. Unknown keys and
 * mistyped values are dropped silently. Returns an error message string when the
 * payload is not a JSON object.
 */
function parseViewerPreferences(
  rawJson: string,
): ViewerPreferences | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { error: 'viewerPreferences must be valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'viewerPreferences must be a JSON object.' };
  }

  const src = parsed as Record<string, unknown>;
  const prefs: ViewerPreferences = {};
  for (const key of VIEWER_PREFERENCE_BOOLEAN_KEYS) {
    if (typeof src[key] === 'boolean') {
      prefs[key] = src[key] as boolean;
    }
  }
  if (src.direction === 'L2R' || src.direction === 'R2L') {
    prefs.direction = src.direction;
  }
  return prefs;
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const action = formData.get('action') as string | null;
    if (action !== 'get' && action !== 'set') {
      return NextResponse.json(
        { success: false, error: 'action must be "get" or "set".' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (action === 'get') {
      const handle = await openDocument(buffer);
      const metadata = getMetadata(handle);
      const xmpBytes = handle._doc.getXmp();
      const xmp =
        xmpBytes && xmpBytes.length > 0
          ? new TextDecoder('utf-8').decode(xmpBytes)
          : null;
      return NextResponse.json({
        success: true,
        data: { metadata, xmp },
      });
    }

    // action === 'set' — collect every supplied operation.
    const metadataRaw = formData.get('metadata') as string | null;
    const xmpRaw = formData.get('xmp') as string | null;
    const viewerPreferencesRaw = formData.get('viewerPreferences') as
      | string
      | null;
    const pageLayoutRaw = formData.get('pageLayout') as string | null;
    const pageModeRaw = formData.get('pageMode') as string | null;

    // Parse + validate the Info patch.
    let metadata: InfoPatch | undefined;
    if (metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw) as InfoPatch;
      } catch {
        return NextResponse.json(
          { success: false, error: 'metadata must be valid JSON.' },
          { status: 400 },
        );
      }
    }

    // Parse + sanitise the viewer preferences.
    let viewerPreferences: ViewerPreferences | undefined;
    if (viewerPreferencesRaw) {
      const result = parseViewerPreferences(viewerPreferencesRaw);
      if ('error' in result) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 },
        );
      }
      viewerPreferences = result;
    }

    // Validate the page layout / mode catalog names.
    const pageLayout =
      pageLayoutRaw && pageLayoutRaw.length > 0 ? pageLayoutRaw : undefined;
    if (pageLayout !== undefined && !PAGE_LAYOUTS.has(pageLayout as PageLayout)) {
      return NextResponse.json(
        {
          success: false,
          error: `pageLayout must be one of: ${[...PAGE_LAYOUTS].join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const pageMode =
      pageModeRaw && pageModeRaw.length > 0 ? pageModeRaw : undefined;
    if (pageMode !== undefined && !PAGE_MODES.has(pageMode as PageMode)) {
      return NextResponse.json(
        {
          success: false,
          error: `pageMode must be one of: ${[...PAGE_MODES].join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const xmp = xmpRaw && xmpRaw.length > 0 ? xmpRaw : undefined;
    if (xmp !== undefined && Buffer.byteLength(xmp, 'utf-8') > MAX_XMP_BYTES) {
      return NextResponse.json(
        { success: false, error: 'xmp payload is too large.' },
        { status: 400 },
      );
    }

    const hasViewerPrefs =
      viewerPreferences !== undefined &&
      Object.keys(viewerPreferences).length > 0;

    if (
      metadata === undefined &&
      xmp === undefined &&
      !hasViewerPrefs &&
      pageLayout === undefined &&
      pageMode === undefined
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            'At least one of metadata, xmp, viewerPreferences, pageLayout or pageMode is required for set action.',
        },
        { status: 400 },
      );
    }

    const handle = await openDocument(buffer);

    // Apply Info first so a raw XMP packet (below) can override the synced
    // /Info → XMP fields if both are supplied.
    if (metadata !== undefined) {
      setMetadata(handle, metadata);
    }
    if (hasViewerPrefs) {
      handle._doc.setViewerPreferences(viewerPreferences as ViewerPreferences);
    }
    if (pageLayout !== undefined) {
      handle._doc.setPageLayout(pageLayout as PageLayout);
    }
    if (pageMode !== undefined) {
      handle._doc.setPageMode(pageMode as PageMode);
    }
    // XMP last: the advanced raw packet wins over the synced Info fields.
    if (xmp !== undefined) {
      handle._doc.setXmp(xmp);
    }

    const savedBytes = await saveDocument(handle);

    return new Response(Buffer.from(savedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.metadata', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process metadata operation.' },
      { status: 500 },
    );
  }
}
