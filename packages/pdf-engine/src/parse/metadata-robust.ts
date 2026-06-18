/**
 * Metadata extraction via the WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path. The engine opens tolerant
 * documents and exposes the `/Info` dictionary entries directly.
 */

import { getEngine } from '../wasm';
import type { DocumentMetadata } from '@giga-pdf/types';

/** PDF date `D:YYYYMMDDHHmmSS…` → ISO 8601, or null if unparseable. */
function parsePdfDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^D:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  try {
    const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
  } catch {
    return null;
  }
}

export async function getMetadataRobust(
  pdfBytes: Uint8Array | Buffer,
): Promise<DocumentMetadata> {
  const giga = await getEngine();
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = giga.open(bytes);
  try {
    const read = (key: string): string | null => {
      const v = doc.getMetadata(key);
      return v && v.length > 0 ? v : null;
    };
    const rawKeywords = read('Keywords');
    const keywords = rawKeywords
      ? rawKeywords.split(',').map((k) => k.trim()).filter(Boolean)
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
      isEncrypted: false,
      permissions: {
        print: true,
        modify: true,
        copy: true,
        annotate: true,
        fillForms: true,
        extract: true,
        assemble: true,
        printHighQuality: true,
      },
    };
  } finally {
    doc.close();
  }
}
