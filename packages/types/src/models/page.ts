/**
 * Page models matching backend Pydantic schemas.
 */

import type { UUID, Dimensions } from "./common";
import type { Element } from "./elements";

export interface MediaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PagePreview {
  thumbnailUrl: string | null;
  fullUrl: string | null;
}

/**
 * A structural block group surfaced by the native engine's `pageBlocks` — the
 * lib being the authoritative source of the page's reading structure. Reduced
 * to what the editor needs to coalesce its flat text runs into Word-like blocks
 * losslessly:
 *
 *   - `kind`          — the engine block type. The editor currently coalesces
 *     only `paragraph` / `heading`; other kinds are carried for forward
 *     compatibility but left to the element-based renderer.
 *   - `sourceIndices` — the engine text-run indices (`source_index`) of the
 *     block's runs, in reading order. They map 1:1 onto `TextElement.index`
 *     (same engine index space used by `replaceText`/`moveElement`), so the
 *     editor resolves each run from its existing parsed element (correct
 *     bounds/style/embedded font) and the lossless in-place edit pipeline keeps
 *     working unchanged.
 */
export interface PageBlockGroup {
  kind:
    | "paragraph"
    | "heading"
    | "list"
    | "table"
    | "image"
    | "shape"
    | "textbox"
    | "sheet"
    | "slide";
  sourceIndices: number[];
}

export interface PageObject {
  pageId: UUID;
  pageNumber: number;
  dimensions: Dimensions & { rotation: 0 | 90 | 180 | 270 };
  mediaBox: MediaBox;
  cropBox: MediaBox | null;
  elements: Element[];
  preview: PagePreview;
  /**
   * Optional structural grouping from the native engine's `pageBlocks`. When
   * present (editor load path), the renderer coalesces the page's flat text
   * runs into paragraph/heading Textboxes using THIS grouping (lib = source of
   * structure) instead of its own positional heuristic. Absent for read-only
   * viewers and any consumer that does not request blocks → the renderer falls
   * back to its heuristic grouping, so the shape stays backward compatible.
   */
  blockGroups?: PageBlockGroup[];
}

export interface PageSummary {
  pageNumber: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  thumbnailUrl: string | null;
}

export type PreviewFormat = "png" | "jpeg" | "webp" | "svg";

export interface PreviewOptions {
  format?: PreviewFormat;
  dpi?: number;
  quality?: number;
  scale?: number;
}
