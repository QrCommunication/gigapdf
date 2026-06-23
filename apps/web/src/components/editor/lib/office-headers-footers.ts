/**
 * office-headers-footers.ts
 *
 * Word-like auto-detection of running headers & footers from an Office document
 * (.docx / .odt / …). When a document originates from Word, its sections may
 * already carry header/footer bands; this module lifts that structure into a
 * `HeaderFooterSpec` the editor can bake onto the converted PDF and pre-fill the
 * dialog with.
 *
 * The unified editable model is produced by the GigaPDF engine
 * ({@link GigaPdfEngine.officeToModel}); we flatten the detected `GigaBlock[]`
 * of the first section that carries a header / footer into plain text.
 *
 * No React, no DOM — pure and unit-testable with an injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";
import type {
  GigaBlock,
  GigaDocument,
  GigaInline,
  GigaPdfEngine,
} from "@qrcommunication/gigapdf-lib";

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = () => Promise<GigaPdfEngine>;

/** The detected header/footer text of a Word-originated document. */
export interface DetectedHeaderFooter {
  /** Flattened header text, or `null` when no section carries a header. */
  header: string | null;
  /** Flattened footer text, or `null` when no section carries a footer. */
  footer: string | null;
}

/** Normalise input bytes to a `Uint8Array` the engine can open. */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Flatten an inline node to its text contribution. Only `run` nodes carry text
 * (in `v.text`); a `br` (line break) becomes a space, and images/links
 * contribute nothing.
 */
function inlineText(inline: GigaInline): string {
  if (inline.t === "run") return inline.v.text;
  if (inline.t === "br") return " ";
  return "";
}

/**
 * Best-effort flatten of a block's runs to text. A block's body lives in
 * `kind.v` (opaque in the model); we only read a `runs: GigaInline[]` shape
 * (paragraphs/headings) — any other shape contributes nothing. Defensive: never
 * throws on an unexpected payload.
 */
function blockText(block: GigaBlock): string {
  const body = block.kind?.v as { runs?: unknown } | undefined;
  const runs = body?.runs;
  if (!Array.isArray(runs)) return "";
  return runs
    .map((run) => inlineText(run as GigaInline))
    .join("")
    .trim();
}

/**
 * Flatten a band (`GigaBlock[]`) to a single line of text: each non-empty block
 * becomes one line. Returns `null` when the band is null/empty or yields no
 * text, so callers can treat "no header" and "empty header" alike.
 */
function flattenBand(blocks: GigaBlock[] | null): string | null {
  if (!blocks || blocks.length === 0) return null;
  const lines = blocks.map(blockText).filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  return lines.join("\n");
}

/**
 * Detect the header/footer text carried by the first section of `model` that
 * has one. v1 of the editor surfaces a single document-wide header and footer,
 * so we take the first non-null band of each kind across sections.
 */
export function detectHeaderFooterFromModel(
  model: GigaDocument | null,
): DetectedHeaderFooter {
  const result: DetectedHeaderFooter = { header: null, footer: null };
  if (!model || !Array.isArray(model.sections)) return result;
  for (const section of model.sections) {
    if (result.header === null) {
      result.header = flattenBand(section.header);
    }
    if (result.footer === null) {
      result.footer = flattenBand(section.footer);
    }
    if (result.header !== null && result.footer !== null) break;
  }
  return result;
}

/**
 * Convert `office` bytes (a .docx / .odt / … document) to the editable model and
 * detect its header/footer text. Returns `{ header: null, footer: null }` when
 * the bytes are not a recognised Office document or carry no bands. Never throws
 * — a detection failure must not break the import.
 */
export async function detectHeaderFooterFromOffice(
  office: ArrayBuffer | Uint8Array,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<DetectedHeaderFooter> {
  try {
    const engine = await loadEngine();
    const model = engine.officeToModel(toBytes(office));
    return detectHeaderFooterFromModel(model);
  } catch {
    return { header: null, footer: null };
  }
}
