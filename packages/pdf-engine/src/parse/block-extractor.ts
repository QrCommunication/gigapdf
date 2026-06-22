import type { PageBlockGroup } from '@giga-pdf/types';
import type { GigaBlock, GigaInline } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';

export type { PageBlockGroup } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Block extractor — backed by the native engine's `pageBlocks(page)`.
//
// `pageBlocks(page)` returns the STRUCTURAL reconstruction of a page's flat
// glyph/path geometry: paragraphs, headings, lists, tables, images and shapes,
// in reading order. Each text run inside a block carries a `source_index` that
// points back to the editable content-stream operator — the SAME unified
// text-run index surfaced by `textElements().index` (see text-extractor.ts) and
// consumed by `replaceText` / `moveElement` / `removeElement`.
//
// This extractor exposes the lib as the authoritative SOURCE OF STRUCTURE while
// the per-run geometry/style stays owned by the proven text extractor: we emit
// only the GROUPING (which `source_index`es form one paragraph/heading, in what
// order), so the editor can coalesce its already-parsed flat `TextElement`s into
// Word-like blocks WITHOUT re-deriving per-run bounds or styles from the block
// `frame` (which would risk drift with the lossless decompose-save path that
// keys each run by its own bounds + engine index).
// ---------------------------------------------------------------------------

// `PageBlockGroup` is defined in `@giga-pdf/types` (shared with the editor) and
// re-exported above. A group reduces ONE engine block to what the editor needs
// to coalesce flat runs losslessly: its `kind` + the ordered, non-null
// `source_index`es of its runs (which map 1:1 onto the parsed `TextElement.index`
// of the same page, so the in-place edit pipeline keeps working unchanged).

/** Read the `{ runs }` body of a paragraph/heading block defensively. */
function blockRuns(block: GigaBlock): GigaInline[] {
  const body = block.kind.v as { runs?: unknown } | undefined;
  const runs = body?.runs;
  return Array.isArray(runs) ? (runs as GigaInline[]) : [];
}

/** Ordered, non-null `source_index` values of a paragraph/heading block. */
function paragraphSourceIndices(block: GigaBlock): number[] {
  const out: number[] = [];
  for (const inline of blockRuns(block)) {
    if (
      inline &&
      typeof inline === 'object' &&
      (inline as { t?: unknown }).t === 'run'
    ) {
      const idx = (inline as { source_index?: number | null }).source_index;
      if (typeof idx === 'number' && idx >= 0) out.push(idx);
    }
  }
  return out;
}

/**
 * Convert the engine's `GigaBlock[]` for a page into the editor's grouping
 * model. Pure & deterministic.
 *
 * Current slice: `paragraph` and `heading` blocks with ≥ 2 editable runs become
 * a {@link PageBlockGroup}; a paragraph/heading of a single run is left out (the
 * editor renders it as a standalone run, identical to today). Other block kinds
 * (`table`, `list`, `image`, `shape`, …) are NOT grouped here — they keep the
 * editor's existing element-based rendering — so this never regresses tables,
 * images, shapes or form fields.
 */
export function gigaBlocksToPageBlockGroups(blocks: GigaBlock[]): PageBlockGroup[] {
  const groups: PageBlockGroup[] = [];
  for (const block of blocks) {
    const kind = block.kind?.t;
    if (kind !== 'paragraph' && kind !== 'heading') continue;
    const sourceIndices = paragraphSourceIndices(block);
    // A lone run is not a multi-line block — the editor already renders single
    // runs as standalone IText, so grouping it would be a no-op (and the
    // decompose-save path expects ≥ 2 runs to be worth a Textbox).
    if (sourceIndices.length < 2) continue;
    groups.push({ kind, sourceIndices });
  }
  return groups;
}

/**
 * Extract the structural block groups for every page of a PDF, grouped by
 * 1-based page number. Opens the document once. Returns an empty map on failure
 * (the editor then falls back to its own heuristic paragraph grouping).
 */
export async function extractPageBlockGroupsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Map<number, PageBlockGroup[]>> {
  const byPage = new Map<number, PageBlockGroup[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const pageCount = doc.pageCount();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const blocks = doc.pageBlocks(pageNumber);
        const groups = gigaBlocksToPageBlockGroups(blocks);
        if (groups.length > 0) byPage.set(pageNumber, groups);
      }
    } finally {
      doc.close();
    }
  } catch {
    // leave the map empty on failure — caller degrades to heuristic grouping
  }
  return byPage;
}

/** Block groups for a single page (convenience wrapper over the grouped map). */
export async function extractPageBlockGroups(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<PageBlockGroup[]> {
  return (await extractPageBlockGroupsByPage(pdfBytes)).get(pageNumber) ?? [];
}
