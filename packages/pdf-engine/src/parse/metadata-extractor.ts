import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type {
  DocumentMetadata,
  DocumentPermissions,
  EmbeddedFileObject,
  NamedDestination,
} from '@giga-pdf/types';
import type { LayerObject } from '@giga-pdf/types';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

function parsePdfDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, min, sec] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
}

export async function extractMetadata(doc: PDFDocumentProxy): Promise<DocumentMetadata> {
  const metadata = await doc.getMetadata();
  const info = (metadata.info ?? {}) as Record<string, unknown>;

  const permissions: DocumentPermissions = {
    print: true,
    modify: true,
    copy: true,
    annotate: true,
    fillForms: true,
    extract: true,
    assemble: true,
    printHighQuality: true,
  };

  const keywordsRaw = typeof info['Keywords'] === 'string' ? info['Keywords'] : '';
  const keywords = keywordsRaw
    ? keywordsRaw.split(/[,;]/).map((k: string) => k.trim()).filter(Boolean)
    : [];

  return {
    title: typeof info['Title'] === 'string' ? info['Title'] : null,
    author: typeof info['Author'] === 'string' ? info['Author'] : null,
    subject: typeof info['Subject'] === 'string' ? info['Subject'] : null,
    keywords,
    creator: typeof info['Creator'] === 'string' ? info['Creator'] : null,
    producer: typeof info['Producer'] === 'string' ? info['Producer'] : null,
    creationDate: parsePdfDate(typeof info['CreationDate'] === 'string' ? info['CreationDate'] : null),
    modificationDate: parsePdfDate(typeof info['ModDate'] === 'string' ? info['ModDate'] : null),
    pageCount: doc.numPages,
    pdfVersion: typeof info['PDFFormatVersion'] === 'string' ? info['PDFFormatVersion'] : '1.7',
    isEncrypted: typeof info['IsEncrypted'] === 'boolean' ? info['IsEncrypted'] : false,
    permissions,
  };
}

export async function extractLayers(doc: PDFDocumentProxy): Promise<LayerObject[]> {
  try {
    const optionalContentConfig = await doc.getOptionalContentConfig();
    if (!optionalContentConfig) return [];

    const groups = optionalContentConfig.getGroups();
    if (!groups) return [];

    return Object.entries(groups).map(([, group], index) => ({
      layerId: randomUUID(),
      name: (group as { name?: string }).name ?? `Layer ${index + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      print: true,
      order: index,
    }));
  } catch {
    return [];
  }
}

export async function extractEmbeddedFiles(doc: PDFDocumentProxy): Promise<EmbeddedFileObject[]> {
  try {
    const attachments = await doc.getAttachments();
    if (!attachments) return [];

    return Object.entries(attachments).map(([name, attachment]) => {
      const att = attachment as {
        filename?: string;
        content?: Uint8Array;
        description?: string;
        creationDate?: string;
        modDate?: string;
        mimeType?: string;
      };
      return {
        fileId: randomUUID(),
        name: att.filename ?? name,
        mimeType: att.mimeType ?? 'application/octet-stream',
        sizeBytes: att.content?.byteLength ?? 0,
        description: att.description ?? null,
        creationDate: att.creationDate ?? null,
        modificationDate: att.modDate ?? null,
        dataUrl: '',
      };
    });
  } catch {
    return [];
  }
}

export async function extractNamedDestinations(
  doc: PDFDocumentProxy,
): Promise<Record<string, NamedDestination>> {
  try {
    const destinations = await doc.getDestinations();
    if (!destinations) return {};

    const result: Record<string, NamedDestination> = {};

    for (const [name, dest] of Object.entries(destinations)) {
      if (!Array.isArray(dest) || dest.length === 0) continue;
      try {
        const pageRef = dest[0] as { num: number; gen: number };
        const pageIndex = await doc.getPageIndex(pageRef);
        result[name] = {
          name,
          pageNumber: pageIndex + 1,
          position: null,
          zoom: null,
        };
      } catch {
        // skip unresolvable destination
      }
    }

    return result;
  } catch {
    return {};
  }
}
