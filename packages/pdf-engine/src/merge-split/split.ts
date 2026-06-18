/**
 * split.ts — Découpe un PDF en plusieurs sous-documents via le moteur
 * zéro-dépendance (`@qrcommunication/gigapdf-lib`). Aucune dépendance pdf-lib.
 *
 * `extractPages([...])` clone le document, restreint l'arbre des pages aux pages
 * demandées (1-based, dans l'ordre) puis garbage-collecte. Conséquences :
 *
 *   - Annotations, champs de formulaire (AcroForm) et signets (Outlines)
 *     rattachés aux pages conservées restent intacts.
 *   - Les liens hypertexte / destinations vers une page hors sélection
 *     deviennent inertes (la page cible n'est plus dans l'arbre) — aucun lien
 *     pendant ni crash : chaque chunk est un PDF autonome valide.
 *
 * Chaque document ouvert est fermé exactement une fois (un double-close
 * piégerait le tas WASM partagé du moteur).
 */

import type { GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';
import { PDFParseError, PDFPageOutOfRangeError } from '../errors';
import type { PageRange } from '../utils/page-range';

function toU8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function splitPDF(buffer: Buffer, ranges: PageRange[]): Promise<Buffer[]> {
  const giga = await getEngine();

  let doc: GigaPdfDoc;
  try {
    doc = giga.open(toU8(buffer));
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const pageCount = doc.pageCount();

    // Validate every range up-front (before producing any output).
    for (const range of ranges) {
      if (range.start < 1) {
        throw new PDFPageOutOfRangeError(range.start, pageCount);
      }
      if (range.end > pageCount) {
        throw new PDFPageOutOfRangeError(range.end, pageCount);
      }
      if (range.start > range.end) {
        throw new PDFParseError(
          `Invalid range: start (${range.start}) must be less than or equal to end (${range.end})`,
        );
      }
    }

    const results: Buffer[] = [];
    for (const range of ranges) {
      const pageNumbers: number[] = [];
      for (let p = range.start; p <= range.end; p++) pageNumbers.push(p);
      results.push(Buffer.from(doc.extractPages(pageNumbers)));
    }
    return results;
  } finally {
    doc.close();
  }
}

export async function splitAt(buffer: Buffer, splitPoints: number[]): Promise<Buffer[]> {
  const giga = await getEngine();

  // Read the page count (own open/close — splitPDF re-opens for the extraction).
  let pageCount: number;
  let doc: GigaPdfDoc;
  try {
    doc = giga.open(toU8(buffer));
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    pageCount = doc.pageCount();
  } finally {
    doc.close();
  }

  const sorted = [...new Set(splitPoints)].sort((a, b) => a - b);

  const ranges: PageRange[] = [];
  if (sorted.length === 0) {
    ranges.push({ start: 1, end: pageCount });
  } else {
    ranges.push({ start: 1, end: sorted[0]! });
    for (let i = 1; i < sorted.length; i++) {
      ranges.push({ start: sorted[i - 1]! + 1, end: sorted[i]! });
    }
    ranges.push({ start: sorted[sorted.length - 1]! + 1, end: pageCount });
  }

  return splitPDF(buffer, ranges);
}
