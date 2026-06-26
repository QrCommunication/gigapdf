/**
 * PDF Links, Open-Action & Bookmarks route
 *
 * POST /api/pdf/links
 * Read or edit a document's hyperlink annotations (`/Link`, ISO 32000-1
 * §12.5.6.5), its open-action (`/OpenAction`, §12.6.4) and its outline /
 * bookmarks (`/Outlines`, §12.3.3) through the engine's rich action model
 * ({@link Action} / {@link Destination} from `@qrcommunication/gigapdf-lib`).
 *
 * Form fields (multipart/form-data):
 *   file    — PDF file (required)
 *   action  — "get" | "addLink" | "removeLink" | "setBookmarks" | "setOpenAction"
 *             | "addNamedDest" | "addGotoLinkNamed"
 *
 *   addLink       — page (1..pageCount), rect (JSON {x,y,w,h}, points) and EXACTLY
 *                   ONE target: uri (http/https/mailto/tel) OR internalPage
 *                   (1..pageCount). A URI becomes a `/A /URI` action; an internal
 *                   page a GoTo `/XYZ` destination.
 *   removeLink    — page (1..pageCount), linkIndex (>= 0, 0-based among the
 *                   page's `/Link` annotations).
 *   setBookmarks  — bookmarks: JSON array of { title, level (>=0), page? }. A
 *                   `page` becomes a GoTo destination; an empty array clears the
 *                   outline. Deeper consecutive `level`s nest as children.
 *   setOpenAction — action: JSON {@link Action} restricted to `goto` | `uri` |
 *                   `named` (powerful launch / javascript / form actions are
 *                   rejected in the editor context).
 *   addNamedDest  — name (non-empty) and page (1..pageCount): defines a document
 *                   named destination (`/Dests`) anchoring `name` to that page.
 *   addGotoLinkNamed — page (1..pageCount), rect (JSON {x,y,w,h}, points) and a
 *                   name: a clickable GoTo link whose target resolves through the
 *                   named destination `name` (catalog-level, robust to page
 *                   reordering). Define `name` first with addNamedDest.
 *
 * "get" — returns JSON `{ success, data: { links, outline, namedDests, pageCount } }`
 *         where `links` is every `/Link` annotation flattened across pages
 *         (each `LinkInfo` augmented with its 1-based `page`), `outline` is the
 *         current `OutlineEntry[]`, and `namedDests` the document's named
 *         destinations.
 * Mutations — apply the change and return the modified PDF as application/pdf
 *         binary.
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument, PDFCorruptedError } from '@giga-pdf/pdf-engine';
import type {
  Action,
  Bookmark,
  Destination,
  LinkInfo,
} from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// A document with thousands of bookmarks/links is pathological; cap counts so a
// malicious payload cannot exhaust the engine.
const MAX_BOOKMARKS = 5000;
const MAX_LEVEL = 32;
// Sanity bound for rect coordinates (points). PDF user space is comfortably
// below this; rejects NaN/Infinity and absurd values.
const MAX_COORD = 1_000_000;
// Named destinations / link-target names are short catalog keys; cap the length.
const MAX_NAME_LENGTH = 256;

// Hyperlink URI schemes accepted on a `/Link` annotation. `javascript:`,
// `file:`, `data:` etc. are rejected to keep authored links inert/safe.
const SAFE_URI_SCHEME = /^(https?:|mailto:|tel:)/i;

// Named navigation actions the engine accepts for `setOpenAction`.
const NAMED_ACTIONS = new Set(['nextPage', 'prevPage', 'firstPage', 'lastPage']);

type ParseError = { error: string };
const isError = (v: unknown): v is ParseError =>
  typeof v === 'object' && v !== null && 'error' in v;

/** Validate an untrusted value as a finite number within `[min, max]`. */
function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Validate an untrusted value as an integer within `[min, max]`. */
function isIntInRange(v: unknown, min: number, max: number): v is number {
  return (
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  );
}

/**
 * Parse + validate a `{ x, y, w, h }` rectangle (PDF points). `x`/`y` may be
 * any finite coordinate; `w`/`h` must be strictly positive.
 */
function parseRect(
  rawJson: string,
): { x: number; y: number; w: number; h: number } | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { error: 'rect must be valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'rect must be an object { x, y, w, h }.' };
  }
  const r = parsed as Record<string, unknown>;
  if (
    !isFiniteInRange(r.x, -MAX_COORD, MAX_COORD) ||
    !isFiniteInRange(r.y, -MAX_COORD, MAX_COORD)
  ) {
    return { error: 'rect.x and rect.y must be finite numbers.' };
  }
  if (
    !isFiniteInRange(r.w, Number.MIN_VALUE, MAX_COORD) ||
    !isFiniteInRange(r.h, Number.MIN_VALUE, MAX_COORD)
  ) {
    return { error: 'rect.w and rect.h must be positive numbers.' };
  }
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/**
 * Parse + validate the `bookmarks` JSON into a {@link Bookmark}[]. Each entry is
 * `{ title, level, page? }`; a present `page` (1..pageCount) becomes a GoTo
 * `/XYZ` action. An empty array is valid (clears the outline).
 */
function parseBookmarks(
  rawJson: string,
  pageCount: number,
): Bookmark[] | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { error: 'bookmarks must be valid JSON.' };
  }
  if (!Array.isArray(parsed)) {
    return { error: 'bookmarks must be a JSON array.' };
  }
  if (parsed.length > MAX_BOOKMARKS) {
    return { error: `bookmarks must contain at most ${MAX_BOOKMARKS} entries.` };
  }

  const bookmarks: Bookmark[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as unknown;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: `bookmarks[${i}] must be an object.` };
    }
    const src = entry as Record<string, unknown>;

    if (typeof src.title !== 'string') {
      return { error: `bookmarks[${i}].title must be a string.` };
    }
    if (!isIntInRange(src.level, 0, MAX_LEVEL)) {
      return {
        error: `bookmarks[${i}].level must be an integer between 0 and ${MAX_LEVEL}.`,
      };
    }

    const bookmark: Bookmark = { title: src.title, level: src.level };

    if (src.page !== undefined && src.page !== null) {
      if (!isIntInRange(src.page, 1, pageCount)) {
        return {
          error: `bookmarks[${i}].page must be an integer between 1 and ${pageCount}.`,
        };
      }
      bookmark.action = { type: 'goto', dest: { fit: 'xyz', page: src.page } };
    }

    bookmarks.push(bookmark);
  }

  return bookmarks;
}

/**
 * Parse + validate a {@link Destination} (used by a `goto` open-action). Only
 * the page-anchored fit modes plus `named` are accepted; `page` is bounded by
 * the document.
 */
function parseDestination(
  src: Record<string, unknown>,
  pageCount: number,
): Destination | ParseError {
  const fit = src.fit;
  if (fit === 'named') {
    if (typeof src.name !== 'string' || src.name.length === 0) {
      return { error: 'dest.name must be a non-empty string for a named destination.' };
    }
    return { fit: 'named', name: src.name };
  }

  // Every other fit mode is page-anchored.
  if (!isIntInRange(src.page, 1, pageCount)) {
    return { error: `dest.page must be an integer between 1 and ${pageCount}.` };
  }
  const page = src.page;
  const top = isFiniteInRange(src.top, -MAX_COORD, MAX_COORD) ? src.top : undefined;
  const left = isFiniteInRange(src.left, -MAX_COORD, MAX_COORD) ? src.left : undefined;

  switch (fit) {
    case 'xyz': {
      const dest: Extract<Destination, { fit: 'xyz' }> = { fit: 'xyz', page };
      if (left !== undefined) dest.left = left;
      if (top !== undefined) dest.top = top;
      if (isFiniteInRange(src.zoom, 0, MAX_COORD)) dest.zoom = src.zoom;
      return dest;
    }
    case 'fit':
      return { fit: 'fit', page };
    case 'fitB':
      return { fit: 'fitB', page };
    case 'fitH':
      return top !== undefined ? { fit: 'fitH', page, top } : { fit: 'fitH', page };
    case 'fitBH':
      return top !== undefined ? { fit: 'fitBH', page, top } : { fit: 'fitBH', page };
    case 'fitV':
      return left !== undefined ? { fit: 'fitV', page, left } : { fit: 'fitV', page };
    case 'fitBV':
      return left !== undefined ? { fit: 'fitBV', page, left } : { fit: 'fitBV', page };
    case 'fitR': {
      const rect = src.rect;
      if (
        !Array.isArray(rect) ||
        rect.length !== 4 ||
        !rect.every((n) => isFiniteInRange(n, -MAX_COORD, MAX_COORD))
      ) {
        return { error: 'dest.rect must be [x0, y0, x1, y1] for a fitR destination.' };
      }
      return {
        fit: 'fitR',
        page,
        rect: rect as [number, number, number, number],
      };
    }
    default:
      return { error: 'dest.fit is not a recognised fit mode.' };
  }
}

/**
 * Parse + validate the `action` JSON for `setOpenAction`. Restricted to
 * `goto` | `uri` | `named` — the powerful `launch` / `javascript` / `submitForm`
 * / `gotoR` actions are rejected so an authored open-action can never run code
 * or reach the network on open.
 */
function parseOpenAction(
  rawJson: string,
  pageCount: number,
): Action | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { error: 'action must be valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'action must be an object.' };
  }
  const src = parsed as Record<string, unknown>;

  switch (src.type) {
    case 'goto': {
      if (
        typeof src.dest !== 'object' ||
        src.dest === null ||
        Array.isArray(src.dest)
      ) {
        return { error: 'action.dest must be an object for a goto action.' };
      }
      const dest = parseDestination(src.dest as Record<string, unknown>, pageCount);
      if (isError(dest)) return dest;
      return { type: 'goto', dest };
    }
    case 'uri': {
      if (typeof src.uri !== 'string' || !SAFE_URI_SCHEME.test(src.uri.trim())) {
        return { error: 'action.uri must be an http(s), mailto or tel URI.' };
      }
      return { type: 'uri', uri: src.uri.trim() };
    }
    case 'named': {
      if (typeof src.action !== 'string' || !NAMED_ACTIONS.has(src.action)) {
        return {
          error: `action.action must be one of: ${[...NAMED_ACTIONS].join(', ')}.`,
        };
      }
      return {
        type: 'named',
        action: src.action as 'nextPage' | 'prevPage' | 'firstPage' | 'lastPage',
      };
    }
    default:
      return {
        error: 'action.type must be one of: goto, uri, named.',
      };
  }
}

/** Build the PDF binary response shared by every mutating action. */
function pdfResponse(savedBytes: Uint8Array, fileName: string): Response {
  return new Response(Buffer.from(savedBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(fileName),
      'Content-Length': String(savedBytes.byteLength),
    },
  });
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
    if (
      action !== 'get' &&
      action !== 'addLink' &&
      action !== 'removeLink' &&
      action !== 'setBookmarks' &&
      action !== 'setOpenAction' &&
      action !== 'addNamedDest' &&
      action !== 'addGotoLinkNamed'
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            'action must be one of: get, addLink, removeLink, setBookmarks, setOpenAction, addNamedDest, addGotoLinkNamed.',
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);
    const doc = handle._doc;
    const pageCount = doc.pageCount();

    // ── get ────────────────────────────────────────────────────────────────
    if (action === 'get') {
      const links: Array<LinkInfo & { page: number }> = [];
      for (let page = 1; page <= pageCount; page++) {
        for (const link of doc.links(page)) {
          links.push({ ...link, page });
        }
      }
      return NextResponse.json({
        success: true,
        data: {
          links,
          outline: doc.outline(),
          namedDests: doc.namedDests(),
          pageCount,
        },
      });
    }

    // ── addLink ──────────────────────────────────────────────────────────────
    if (action === 'addLink') {
      const pageRaw = formData.get('page');
      const page = Number(pageRaw);
      if (pageRaw === null || !isIntInRange(page, 1, pageCount)) {
        return NextResponse.json(
          { success: false, error: `page must be an integer between 1 and ${pageCount}.` },
          { status: 400 },
        );
      }

      const rectRaw = formData.get('rect') as string | null;
      if (rectRaw === null) {
        return NextResponse.json(
          { success: false, error: 'rect is required for addLink.' },
          { status: 400 },
        );
      }
      const rect = parseRect(rectRaw);
      if (isError(rect)) {
        return NextResponse.json({ success: false, error: rect.error }, { status: 400 });
      }

      const uriRaw = formData.get('uri') as string | null;
      const internalPageRaw = formData.get('internalPage') as string | null;
      const hasUri = uriRaw !== null && uriRaw.trim() !== '';
      const hasInternal = internalPageRaw !== null && internalPageRaw !== '';
      if (hasUri === hasInternal) {
        return NextResponse.json(
          {
            success: false,
            error: 'addLink requires exactly one target: uri OR internalPage.',
          },
          { status: 400 },
        );
      }

      let linkAction: Action;
      if (hasUri) {
        const uri = (uriRaw as string).trim();
        if (!SAFE_URI_SCHEME.test(uri)) {
          return NextResponse.json(
            { success: false, error: 'uri must be an http(s), mailto or tel URI.' },
            { status: 400 },
          );
        }
        linkAction = { type: 'uri', uri };
      } else {
        const internalPage = Number(internalPageRaw);
        if (!isIntInRange(internalPage, 1, pageCount)) {
          return NextResponse.json(
            {
              success: false,
              error: `internalPage must be an integer between 1 and ${pageCount}.`,
            },
            { status: 400 },
          );
        }
        linkAction = { type: 'goto', dest: { fit: 'xyz', page: internalPage } };
      }

      const ok = doc.addLink(page, rect, linkAction);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Could not add the link.' },
          { status: 422 },
        );
      }
      const savedBytes = await saveDocument(handle);
      return pdfResponse(savedBytes, file.name);
    }

    // ── removeLink ─────────────────────────────────────────────────────────
    if (action === 'removeLink') {
      const pageRaw = formData.get('page');
      const page = Number(pageRaw);
      if (pageRaw === null || !isIntInRange(page, 1, pageCount)) {
        return NextResponse.json(
          { success: false, error: `page must be an integer between 1 and ${pageCount}.` },
          { status: 400 },
        );
      }

      const linkIndexRaw = formData.get('linkIndex');
      const linkIndex = Number(linkIndexRaw);
      if (linkIndexRaw === null || !isIntInRange(linkIndex, 0, Number.MAX_SAFE_INTEGER)) {
        return NextResponse.json(
          { success: false, error: 'linkIndex must be an integer >= 0.' },
          { status: 400 },
        );
      }

      const ok = doc.removeLink(page, linkIndex);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'No link found at the given index on that page.' },
          { status: 404 },
        );
      }
      const savedBytes = await saveDocument(handle);
      return pdfResponse(savedBytes, file.name);
    }

    // ── setBookmarks ─────────────────────────────────────────────────────────
    if (action === 'setBookmarks') {
      const bookmarksRaw = formData.get('bookmarks') as string | null;
      if (bookmarksRaw === null) {
        return NextResponse.json(
          { success: false, error: 'bookmarks is required for setBookmarks.' },
          { status: 400 },
        );
      }
      const bookmarks = parseBookmarks(bookmarksRaw, pageCount);
      if (isError(bookmarks)) {
        return NextResponse.json({ success: false, error: bookmarks.error }, { status: 400 });
      }

      const ok = doc.setBookmarks(bookmarks);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Could not set the bookmarks.' },
          { status: 422 },
        );
      }
      const savedBytes = await saveDocument(handle);
      return pdfResponse(savedBytes, file.name);
    }

    // ── addNamedDest ─────────────────────────────────────────────────────────
    if (action === 'addNamedDest') {
      const name = (formData.get('name') as string | null)?.trim();
      if (!name || name.length > MAX_NAME_LENGTH) {
        return NextResponse.json(
          {
            success: false,
            error: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters.`,
          },
          { status: 400 },
        );
      }
      const pageRaw = formData.get('page');
      const page = Number(pageRaw);
      if (pageRaw === null || !isIntInRange(page, 1, pageCount)) {
        return NextResponse.json(
          { success: false, error: `page must be an integer between 1 and ${pageCount}.` },
          { status: 400 },
        );
      }

      const ok = doc.addNamedDest(name, page);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Could not create the named destination.' },
          { status: 422 },
        );
      }
      const savedBytes = await saveDocument(handle);
      return pdfResponse(savedBytes, file.name);
    }

    // ── addGotoLinkNamed ──────────────────────────────────────────────────────
    if (action === 'addGotoLinkNamed') {
      const pageRaw = formData.get('page');
      const page = Number(pageRaw);
      if (pageRaw === null || !isIntInRange(page, 1, pageCount)) {
        return NextResponse.json(
          { success: false, error: `page must be an integer between 1 and ${pageCount}.` },
          { status: 400 },
        );
      }

      const rectRaw = formData.get('rect') as string | null;
      if (rectRaw === null) {
        return NextResponse.json(
          { success: false, error: 'rect is required for addGotoLinkNamed.' },
          { status: 400 },
        );
      }
      const rect = parseRect(rectRaw);
      if (isError(rect)) {
        return NextResponse.json({ success: false, error: rect.error }, { status: 400 });
      }

      const name = (formData.get('name') as string | null)?.trim();
      if (!name || name.length > MAX_NAME_LENGTH) {
        return NextResponse.json(
          {
            success: false,
            error: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters.`,
          },
          { status: 400 },
        );
      }

      const ok = doc.addGotoLinkNamed(
        page,
        rect.x,
        rect.y,
        rect.x + rect.w,
        rect.y + rect.h,
        name,
      );
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Could not add the named GoTo link.' },
          { status: 422 },
        );
      }
      const savedBytes = await saveDocument(handle);
      return pdfResponse(savedBytes, file.name);
    }

    // ── setOpenAction ─────────────────────────────────────────────────────────
    // action === 'setOpenAction'
    const openActionRaw = formData.get('action_payload') as string | null;
    if (openActionRaw === null) {
      return NextResponse.json(
        { success: false, error: 'action_payload is required for setOpenAction.' },
        { status: 400 },
      );
    }
    const openAction = parseOpenAction(openActionRaw, pageCount);
    if (isError(openAction)) {
      return NextResponse.json({ success: false, error: openAction.error }, { status: 400 });
    }

    const ok = doc.setOpenAction(openAction);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: 'Could not set the open action.' },
        { status: 422 },
      );
    }
    const savedBytes = await saveDocument(handle);
    return pdfResponse(savedBytes, file.name);
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.links', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process links operation.' },
      { status: 500 },
    );
  }
}
