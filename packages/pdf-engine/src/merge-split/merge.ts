/**
 * merge.ts — Fusionne plusieurs PDF en un seul via le moteur zéro-dépendance
 * (`@qrcommunication/gigapdf-lib`). Aucune dépendance pdf-lib.
 *
 * Stratégie en deux passes :
 *
 *   Passe 1 — pour chaque source on calcule les *octets de la part* à fusionner :
 *     - sans `pageRanges` → les octets source tels quels ;
 *     - avec `pageRanges` → `extractPages()` produit un sous-PDF des seules pages
 *       demandées (1-based, dans l'ordre).
 *     On lit au passage le sommaire (outline) de la source et son nombre de pages
 *     pour reconstruire un sommaire fusionné décalé. Chaque source est ouverte ET
 *     fermée exactement une fois (le double-close piégerait le tas WASM partagé).
 *
 *   Passe 2 — on ouvre la première part comme document de base, on `appendPages()`
 *     chacune des suivantes, on réapplique le sommaire fusionné via `setOutline()`
 *     et on sérialise en flux objets compressés.
 *
 * `appendPages` recopie pages + ressources + annotations (liens GoTo internes
 * remappés). Les signets sont préservés par le plumbing `outline()/setOutline()`
 * ci-dessous : l'append bas-niveau ne transporte pas l'outline de la source.
 */

import type { GigaPdfDoc, OutlineEntry } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';
import { PDFParseError } from '../errors';
import type { PageRange } from '../utils/page-range';

export interface MergeOptions {
  /** Per-document page ranges (1-based, inclusive). `null` = all pages of that document. */
  pageRanges?: (PageRange[] | null)[];
}

function toU8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Flatten 1-based, inclusive page ranges into an ordered list of page numbers. */
function rangesToPageNumbers(ranges: PageRange[]): number[] {
  const pages: number[] = [];
  for (const range of ranges) {
    for (let p = range.start; p <= range.end; p++) pages.push(p);
  }
  return pages;
}

export async function mergePDFs(buffers: Buffer[], options?: MergeOptions): Promise<Buffer> {
  if (buffers.length < 2) {
    throw new PDFParseError('At least 2 PDF buffers are required to merge');
  }

  const giga = await getEngine();

  // ---- Passe 1 : octets des parts + sommaire fusionné ----------------------
  const partBytes: Uint8Array[] = [];
  const mergedOutline: OutlineEntry[] = [];
  let pageOffset = 0;

  for (let i = 0; i < buffers.length; i++) {
    const raw = toU8(buffers[i]!);

    let srcDoc: GigaPdfDoc;
    try {
      srcDoc = giga.open(raw);
    } catch (err) {
      throw new PDFParseError(
        `Failed to parse PDF at index ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const ranges = options?.pageRanges?.[i] ?? null;

      let bytes: Uint8Array;
      let partPageCount: number;
      // Map a *source* 1-based page number → its 1-based position inside the part
      // (identity when no range is applied).
      let positionOf: (sourcePage: number) => number | undefined;

      if (ranges != null) {
        const pageNumbers = rangesToPageNumbers(ranges);
        bytes = srcDoc.extractPages(pageNumbers);
        partPageCount = pageNumbers.length;
        const map = new Map<number, number>();
        pageNumbers.forEach((srcPage, idx) => {
          if (!map.has(srcPage)) map.set(srcPage, idx + 1);
        });
        positionOf = (srcPage) => map.get(srcPage);
      } else {
        bytes = raw;
        partPageCount = srcDoc.pageCount();
        positionOf = (srcPage) => srcPage;
      }

      // Carry the source outline forward, remapped to the merged page numbering.
      for (const item of srcDoc.outline()) {
        let page: number | undefined;
        if (item.page != null && item.page > 0) {
          const pos = positionOf(item.page);
          if (pos != null) page = pos + pageOffset;
        }
        mergedOutline.push({
          level: item.level,
          title: item.title,
          ...(page != null ? { page } : {}),
        });
      }

      partBytes.push(bytes);
      pageOffset += partPageCount;
    } finally {
      srcDoc.close();
    }
  }

  // ---- Passe 2 : base + append + outline + sérialisation -------------------
  const base = giga.open(partBytes[0]!);
  try {
    for (let i = 1; i < partBytes.length; i++) {
      base.appendPages(partBytes[i]!);
    }
    if (mergedOutline.length > 0) {
      base.setOutline(mergedOutline);
    }
    return Buffer.from(base.saveCompressed());
  } finally {
    base.close();
  }
}
