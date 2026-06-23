import { randomUUID } from 'node:crypto';
import type {
  DocumentLanguageInfo,
  DocumentMetadata,
  DocumentPermissions,
  EmbeddedFileObject,
  NamedDestination,
} from '@giga-pdf/types';
import type { LayerObject } from '@giga-pdf/types';
import { getEngine } from '../wasm';

/**
 * Document-level extractors (metadata, layers, embedded files, named
 * destinations) backed entirely by the native engine — no pdfjs. Each opens the
 * document from raw bytes via the WASM engine and reads structure directly.
 */

function toBytes(pdfBytes: Buffer | ArrayBuffer | Uint8Array): Uint8Array {
  return pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
}

function parsePdfDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, min, sec] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
}

export async function extractMetadata(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<DocumentMetadata> {
  const giga = await getEngine();
  const bytes = toBytes(pdfBytes);

  // The engine never throws across the boundary; defaults below cover failures.
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

  let isEncrypted = false;
  try {
    isEncrypted = giga.encryptionInfo(bytes).encrypted;
  } catch {
    isEncrypted = false;
  }

  const doc = giga.open(bytes);
  try {
    const read = (key: string): string | null => {
      const v = doc.getMetadata(key);
      return v && v.length > 0 ? v : null;
    };
    const keywordsRaw = read('Keywords') ?? '';
    const keywords = keywordsRaw
      ? keywordsRaw.split(/[,;]/).map((k) => k.trim()).filter(Boolean)
      : [];

    return {
      title: read('Title'),
      author: read('Author'),
      subject: read('Subject'),
      keywords,
      creator: read('Creator'),
      producer: read('Producer'),
      creationDate: parsePdfDate(read('CreationDate')),
      modificationDate: parsePdfDate(read('ModDate')),
      pageCount: doc.pageCount(),
      pdfVersion: '1.7',
      isEncrypted,
      permissions,
    };
  } finally {
    doc.close();
  }
}

export async function extractLayers(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<LayerObject[]> {
  try {
    const giga = await getEngine();
    const doc = giga.open(toBytes(pdfBytes));
    try {
      // `layer.id` is the native OCG id — preserved as `ocgId` so the editor can
      // drive the native OCG mutators (visibility/lock/remove) by that id.
      return doc.layers().map((layer, index) => ({
        layerId: randomUUID(),
        name: layer.name || `Layer ${index + 1}`,
        visible: layer.visible,
        locked: layer.locked,
        opacity: 1,
        print: true,
        order: index,
        ocgId: layer.id,
      }));
    } finally {
      doc.close();
    }
  } catch {
    return [];
  }
}

/**
 * Detect the document's dominant reading direction / script from its parsed
 * glyphs via the native engine. Returns `undefined` on failure or when the
 * engine cannot decide (e.g. an image-only / empty document), so callers can
 * omit the field rather than surface a misleading default.
 */
export async function extractDocumentLanguage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<DocumentLanguageInfo | undefined> {
  try {
    const giga = await getEngine();
    const doc = giga.open(toBytes(pdfBytes));
    try {
      const raw = doc.documentLanguage();
      const info: DocumentLanguageInfo = {
        direction: raw.direction,
        script: raw.script,
      };
      if (raw.lang) info.lang = raw.lang;
      return info;
    } finally {
      doc.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Extract every embedded file from the document's `/Names /EmbeddedFiles` name
 * tree via the native engine (`attachments()`), which decodes the file streams
 * (filters applied). Each entry carries the real bytes as a base64 `data:` URI
 * and an accurate size.
 */
export async function extractEmbeddedFiles(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<EmbeddedFileObject[]> {
  try {
    const giga = await getEngine();
    const doc = giga.open(toBytes(pdfBytes));
    try {
      return doc.attachments().map((att) => {
        const mimeType = att.mime ?? 'application/octet-stream';
        const dataUrl =
          att.data.length > 0
            ? `data:${mimeType};base64,${Buffer.from(att.data).toString('base64')}`
            : '';
        return {
          fileId: randomUUID(),
          name: att.filename || att.name,
          mimeType,
          sizeBytes: att.data.length,
          description: att.description,
          creationDate: parsePdfDate(att.creationDate),
          modificationDate: parsePdfDate(att.modDate),
          dataUrl,
        };
      });
    } finally {
      doc.close();
    }
  } catch {
    return [];
  }
}

export async function extractNamedDestinations(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Record<string, NamedDestination>> {
  try {
    const giga = await getEngine();
    const doc = giga.open(toBytes(pdfBytes));
    try {
      const result: Record<string, NamedDestination> = {};
      for (const dest of doc.namedDests()) {
        result[dest.name] = {
          name: dest.name,
          pageNumber: dest.page,
          position: null,
          zoom: null,
        };
      }
      return result;
    } finally {
      doc.close();
    }
  } catch {
    return {};
  }
}
