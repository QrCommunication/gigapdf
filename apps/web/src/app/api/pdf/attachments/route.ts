/**
 * PDF attachments + associated files (Factur-X / ZUGFeRD / Order-X) route via
 * the WASM engine.
 *
 * GET  /api/pdf/attachments — list every embedded file attachment as JSON.
 * POST /api/pdf/attachments — add or remove an attachment (returns the modified
 *                             PDF binary).
 *
 * GET — multipart/form-data:
 *   file        — PDF file (required)
 *   → 200 `{ success: true, data: { attachments: EmbeddedFileObject[] } }`
 *
 * POST — multipart/form-data:
 *   file          — PDF file (required)
 *   action        — "add" | "remove" (required)
 *
 *   action="add":
 *     attachment    — the file to embed (required, ≤ 50 MB)
 *     name          — `/EmbeddedFiles` name-tree key / display filename
 *                     (optional, defaults to the uploaded file's own name)
 *     description   — human-readable `/Desc` (optional)
 *     mime          — embedded stream `/Subtype` (optional, defaults to the
 *                     uploaded file's MIME type)
 *     relationship  — an {@link AfRelationship}. When present the file is embedded
 *                     as an ISO 32000-2 `/AF` **associated file** (the mechanism
 *                     Factur-X / ZUGFeRD / Order-X use — the invoice XML is
 *                     "alternative"). Omitted → a plain document-level attachment.
 *     annotate      — "true"/"1" → also drop a page-anchored FileAttachment
 *                     annotation pointing at the embedded file.
 *     page          — 1-based page for the annotation (default 1)
 *     rect          — JSON `{x,y,w,h}` (PDF points) for the annotation
 *                     (default a small box near the top-left)
 *     icon          — a {@link FileAttachmentIcon} for the annotation (default
 *                     "PushPin")
 *
 *   action="remove":
 *     name          — the attachment name to remove (required)
 *
 *   → 200 application/pdf binary (the modified document)
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because the attachment / associated-file surface is exposed by GigaPdfDoc;
 * @qrcommunication/gigapdf-lib is a server-external package whose `gigapdf.wasm`
 * is traced for `/api/pdf/**` (see next.config.ts).
 */

import { NextResponse } from 'next/server';
import {
  GigaPdfEngine,
  type GigaPdfDoc,
  type Attachment,
  type AttachmentOptions,
  type AfRelationship,
  type FileAttachmentIcon,
  type Box,
} from '@qrcommunication/gigapdf-lib';
import type { EmbeddedFileObject } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

/**
 * 50 MB cap on a single embedded file — generous for invoice XML, images, or a
 * nested PDF while bounding the base64 expansion of the JSON list response.
 */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const AF_RELATIONSHIPS: readonly AfRelationship[] = [
  'source',
  'data',
  'alternative',
  'supplement',
  'unspecified',
];

const FILE_ATTACHMENT_ICONS: readonly FileAttachmentIcon[] = [
  'PushPin',
  'Paperclip',
  'Graph',
  'Tag',
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

/** Generate a stable-enough id for the editor's EmbeddedFileObject view. */
function newFileId(seed: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `att-${seed}`;
}

/**
 * Map an engine {@link Attachment} (decoded bytes + filespec metadata) to the
 * editor's {@link EmbeddedFileObject} shape so the GET list is consumed directly
 * by the embedded-files panel (it carries a ready-to-download `data:` URL).
 */
function toEmbeddedFileObject(att: Attachment): EmbeddedFileObject {
  const mimeType = att.mime ?? 'application/octet-stream';
  const base64 = Buffer.from(att.data).toString('base64');
  return {
    fileId: newFileId(`${att.name}-${att.data.length}`),
    name: att.filename || att.name,
    mimeType,
    sizeBytes: att.data.length,
    description: att.description,
    creationDate: att.creationDate,
    modificationDate: att.modDate,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

/** Parse the optional annotation `rect` JSON into a {@link Box}; `null` = malformed. */
function parseRect(raw: FormDataEntryValue | null): Box | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    // Default: a small marker near the top-left (PDF points, origin bottom-left).
    return { x: 36, y: 720, w: 24, h: 24 };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    const nums = [r.x, r.y, r.w, r.h];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number };
  } catch {
    return null;
  }
}

/**
 * GET — list the document's embedded file attachments.
 * The PDF is supplied as a multipart `file` field (server / API clients); the
 * browser editor lists from its already-parsed document state, so it never needs
 * a GET body.
 */
export async function GET(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;

    const bytes = new Uint8Array(await fileValidation.file.arrayBuffer());

    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);
      const attachments = doc.attachments().map(toEmbeddedFileObject);
      return NextResponse.json({ success: true, data: { attachments } });
    } catch (engineError: unknown) {
      serverLogger.warn('api.pdf.attachments.list.engine', { error: engineError });
      return NextResponse.json(
        { success: false, error: 'Could not read attachments. The PDF may be corrupted.' },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.attachments.list', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to list attachments.' },
      { status: 500 },
    );
  }
}

/**
 * POST — add or remove an attachment, returning the modified PDF binary.
 */
export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const action = formData.get('action');
    if (action !== 'add' && action !== 'remove') {
      return NextResponse.json(
        { success: false, error: 'action must be "add" or "remove".' },
        { status: 400 },
      );
    }

    // ── Per-action input validation (before touching the engine) ──────────────
    let attachmentBytes: Uint8Array | null = null;
    let addName = '';
    let opts: AttachmentOptions = {};
    let relationship: AfRelationship | undefined;
    let annotate = false;
    let annotPage = 1;
    let annotRect: Box | null = null;
    let annotIcon: FileAttachmentIcon = 'PushPin';
    let removeName = '';

    if (action === 'add') {
      const attachment = formData.get('attachment');
      if (!attachment || !(attachment instanceof File)) {
        return NextResponse.json(
          { success: false, error: 'attachment file field missing or invalid.' },
          { status: 400 },
        );
      }
      if (attachment.size === 0) {
        return NextResponse.json(
          { success: false, error: 'attachment file is empty.' },
          { status: 400 },
        );
      }
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `attachment exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB size limit.`,
          },
          { status: 413 },
        );
      }

      const nameRaw = formData.get('name');
      addName =
        typeof nameRaw === 'string' && nameRaw.trim() !== ''
          ? nameRaw.trim()
          : attachment.name;
      if (addName === '') {
        return NextResponse.json(
          { success: false, error: 'A non-empty attachment name is required.' },
          { status: 400 },
        );
      }

      const descriptionRaw = formData.get('description');
      const mimeRaw = formData.get('mime');
      const mime =
        typeof mimeRaw === 'string' && mimeRaw.trim() !== ''
          ? mimeRaw.trim()
          : attachment.type || undefined;
      opts = {
        ...(mime ? { mime } : {}),
        ...(typeof descriptionRaw === 'string' && descriptionRaw !== ''
          ? { description: descriptionRaw }
          : {}),
      };

      const relationshipRaw = formData.get('relationship');
      if (typeof relationshipRaw === 'string' && relationshipRaw !== '') {
        if (!AF_RELATIONSHIPS.includes(relationshipRaw as AfRelationship)) {
          return NextResponse.json(
            {
              success: false,
              error: `relationship must be one of: ${AF_RELATIONSHIPS.join(', ')}.`,
            },
            { status: 400 },
          );
        }
        relationship = relationshipRaw as AfRelationship;
      }

      const annotateRaw = formData.get('annotate');
      annotate = annotateRaw === 'true' || annotateRaw === '1';
      if (annotate) {
        annotRect = parseRect(formData.get('rect'));
        if (annotRect === null) {
          return NextResponse.json(
            { success: false, error: 'rect must be a JSON object {x,y,w,h} of numbers.' },
            { status: 400 },
          );
        }
        const pageRaw = formData.get('page');
        const parsedPage =
          typeof pageRaw === 'string' && pageRaw !== '' ? Number(pageRaw) : 1;
        if (!Number.isInteger(parsedPage) || parsedPage < 1) {
          return NextResponse.json(
            { success: false, error: 'page must be a positive integer.' },
            { status: 400 },
          );
        }
        annotPage = parsedPage;
        const iconRaw = formData.get('icon');
        if (typeof iconRaw === 'string' && iconRaw !== '') {
          if (!FILE_ATTACHMENT_ICONS.includes(iconRaw as FileAttachmentIcon)) {
            return NextResponse.json(
              {
                success: false,
                error: `icon must be one of: ${FILE_ATTACHMENT_ICONS.join(', ')}.`,
              },
              { status: 400 },
            );
          }
          annotIcon = iconRaw as FileAttachmentIcon;
        }
      }

      attachmentBytes = new Uint8Array(await attachment.arrayBuffer());
    } else {
      // action === 'remove'
      const nameRaw = formData.get('name');
      if (typeof nameRaw !== 'string' || nameRaw.trim() === '') {
        return NextResponse.json(
          { success: false, error: 'A non-empty attachment name is required for removal.' },
          { status: 400 },
        );
      }
      removeName = nameRaw.trim();
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      if (action === 'add') {
        const ok = relationship
          ? doc.addAssociatedFile(addName, attachmentBytes as Uint8Array, relationship, opts)
          : doc.addAttachment(addName, attachmentBytes as Uint8Array, opts);
        if (!ok) {
          return NextResponse.json(
            { success: false, error: 'The attachment could not be embedded.' },
            { status: 422 },
          );
        }
        if (annotate && annotRect) {
          // Best-effort visual marker; failure (e.g. page out of range) must not
          // discard the successful embed.
          doc.addFileAttachmentAnnot(annotPage, annotRect, addName, annotIcon);
        }
      } else {
        const removed = doc.removeAttachment(removeName);
        if (!removed) {
          return NextResponse.json(
            { success: false, error: `No attachment named "${removeName}" was found.` },
            { status: 404 },
          );
        }
      }

      const out = doc.save();

      return new Response(Buffer.from(out), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(out.byteLength),
          'X-Attachment-Action': action,
        },
      });
    } catch (engineError: unknown) {
      // The inputs are validated at this point, so an engine failure means a
      // corrupt/unsupported source — a client-correctable 422, not a server fault.
      serverLogger.warn('api.pdf.attachments.mutate.engine', { error: engineError, action });
      return NextResponse.json(
        {
          success: false,
          error: 'The attachment operation failed. The PDF may be corrupted or unsupported.',
        },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.attachments', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process the attachment operation.' },
      { status: 500 },
    );
  }
}
