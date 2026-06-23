/**
 * Native model-op bake — the BlockAddr bridge for paragraph/list formatting.
 *
 * The editor edits text in place by a FLAT run index (`source_index`, surfaced
 * as `TextElement.index` and consumed by `replaceText`/`moveElement`/...). The
 * engine's structural edit API (`applyModelOps`) instead addresses content by a
 * positional {@link GigaBlockAddr} `[section, page, index]`. This module is the
 * missing seam between the two identity spaces.
 *
 * `buildSourceIndexAddrMap(model)` walks the unified {@link GigaDocument} tree
 * (`sections → pages → blocks → runs`) once and records, for every run that
 * carries a `source_index`, the address of the paragraph/heading block that
 * owns it. That map turns the editor's flat `source_index` (which it already
 * holds) into a `GigaBlockAddr`, with NO new data needed editor-side and NO
 * change to the lib.
 *
 * `applyParagraphOps(bytes, edits)` is the end-to-end "fat-library" bake:
 *   open(bytes) → toModel() → build the source_index→addr map → resolve each
 *   edit's `sourceIndex` to a `BlockAddr` → emit `setParagraphStyle` /
 *   `setList*` {@link ModelOp}s → applyModelOps(model, ops) → modelToPdf(model).
 * The result reflects the new paragraph formatting natively in the PDF model
 * (alignment/indents/spacing/line-height, list level/marker/ordered), so a
 * reload of the returned bytes shows the change — the bake is real, not an
 * overlay.
 *
 * `applyModelOps(bytes, ops)` is the lower-level escape hatch: apply an
 * already-addressed batch of {@link ModelOp}s (caller owns the addresses) and
 * re-render to PDF. Out-of-range addresses are silently skipped by the engine,
 * so a partially-valid batch never throws.
 */

import type {
  GigaBlock,
  GigaBlockAddr,
  GigaDocument,
  GigaInline,
  GigaListMarker,
  GigaParaPatch,
  ModelOp,
} from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

// Re-export the lib's model-edit vocabulary so callers (routes, app layer) have
// a single import surface and never depend on the lib package directly.
export type {
  GigaBlockAddr,
  GigaDocument,
  GigaListMarker,
  GigaParaPatch,
  ModelOp,
} from '@qrcommunication/gigapdf-lib';

/**
 * A paragraph-style edit keyed by the editor's flat engine run index
 * (`source_index` === `TextElement.index`). The block that owns the run is
 * resolved to its {@link GigaBlockAddr} internally.
 */
export interface ParagraphStyleEdit {
  /** Engine content-stream run index (the editor's `TextElement.index`). */
  sourceIndex: number;
  /** Paragraph-level formatting to set (only the provided fields change). */
  patch: GigaParaPatch;
}

/** A list-level edit keyed by a run's flat `source_index` (as above). */
export type ListEdit =
  | { sourceIndex: number; kind: 'level'; level: number }
  | { sourceIndex: number; kind: 'marker'; marker: GigaListMarker }
  | { sourceIndex: number; kind: 'ordered'; ordered: boolean };

export interface ApplyParagraphOpsResult {
  /** PDF bytes re-rendered from the edited model. */
  bytes: Uint8Array;
  /** How many edits resolved to a block address and produced an op. */
  resolved: number;
  /** Source indices that did not resolve to any paragraph/heading block. */
  unresolved: number[];
}

/** Tuple-key for the (section,page,index) address used in op emission. */
type AddrKey = `${number}:${number}:${number}`;

const addrKey = (addr: GigaBlockAddr): AddrKey =>
  `${addr[0]}:${addr[1]}:${addr[2]}`;

/** Read the `{ runs }` body of a paragraph block defensively (typed + runtime). */
function paragraphRuns(block: GigaBlock): GigaInline[] {
  const v = block.kind?.v as { runs?: unknown } | undefined;
  const runs = v?.runs;
  return Array.isArray(runs) ? (runs as GigaInline[]) : [];
}

/** Read the `{ para: { runs } }` body of a heading block defensively. */
function headingRuns(block: GigaBlock): GigaInline[] {
  const v = block.kind?.v as { para?: { runs?: unknown } } | undefined;
  const runs = v?.para?.runs;
  return Array.isArray(runs) ? (runs as GigaInline[]) : [];
}

/**
 * Pull the `source_index`es out of an inline run list, reading BOTH the typed
 * flat shape `{ t:'run', source_index }` and the runtime-wrapped shape
 * `{ t:'run', v:{ source_index } }` (the engine emits the wrapped form for some
 * nested contexts). A `link` wraps children, so recurse into it.
 */
function collectRunSourceIndices(runs: GigaInline[], out: number[]): void {
  for (const inline of runs) {
    if (!inline || typeof inline !== 'object') continue;
    const t = (inline as { t?: unknown }).t;
    if (t === 'run') {
      const flat = (inline as { source_index?: number | null }).source_index;
      const wrapped = (inline as { v?: { source_index?: number | null } }).v;
      const idx =
        typeof flat === 'number'
          ? flat
          : wrapped && typeof wrapped === 'object'
            ? wrapped.source_index
            : null;
      if (typeof idx === 'number' && idx >= 0) out.push(idx);
    } else if (t === 'link') {
      const children = (inline as { children?: unknown }).children;
      if (Array.isArray(children)) {
        collectRunSourceIndices(children as GigaInline[], out);
      }
    }
  }
}

/**
 * Record every `source_index` of the paragraph/heading `block` against `addr`
 * in `map`. Only paragraph and heading blocks accept `setParagraphStyle`; other
 * kinds (table/list/image/shape/...) are addressed differently and are skipped
 * here (their nested paragraphs are not individually addressable as top-level
 * blocks, which is consistent with the editor's run-level grouping).
 */
function indexBlock(
  block: GigaBlock,
  addr: GigaBlockAddr,
  map: Map<number, GigaBlockAddr>,
): void {
  const kind = block.kind?.t;
  let runs: GigaInline[] | null = null;
  if (kind === 'paragraph') runs = paragraphRuns(block);
  else if (kind === 'heading') runs = headingRuns(block);
  if (!runs) return;

  const indices: number[] = [];
  collectRunSourceIndices(runs, indices);
  for (const idx of indices) {
    // First writer wins — `source_index`es are unique per document in practice;
    // this guards against any accidental duplicate so the address stays stable.
    if (!map.has(idx)) map.set(idx, addr);
  }
}

/**
 * Build the `source_index → GigaBlockAddr` map for a whole document model.
 *
 * Walks `sections[s].pages[p].blocks[i]` in order; for each paragraph/heading
 * block, every run `source_index` maps to `[s, p, i]`. Pure & deterministic.
 *
 * This is the flat-index ↔ BlockAddr bridge: the editor already holds the flat
 * `source_index` on each text element, so this map is all that is needed to
 * address a selected paragraph with a {@link ModelOp}.
 */
export function buildSourceIndexAddrMap(
  model: GigaDocument,
): Map<number, GigaBlockAddr> {
  const map = new Map<number, GigaBlockAddr>();
  const sections = Array.isArray(model.sections) ? model.sections : [];
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    const pages = Array.isArray(section?.pages) ? section.pages : [];
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p];
      const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block) indexBlock(block, [s, p, i], map);
      }
    }
  }
  return map;
}

/**
 * Apply an already-addressed batch of {@link ModelOp}s to a PDF and re-render.
 *
 * The caller owns the {@link GigaBlockAddr}s. Opens the document, lowers it to
 * the unified model, applies the ops (out-of-range addresses skipped by the
 * engine), and raises the edited model back to PDF.
 */
export async function applyModelOps(
  bytes: Buffer | Uint8Array | ArrayBuffer,
  ops: ModelOp[],
): Promise<Uint8Array> {
  const engine = await getEngine();
  const data =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes as ArrayBuffer);
  const doc = engine.open(data);
  try {
    const model = doc.toModel();
    const edited = ops.length > 0 ? engine.applyModelOps(model, ops) : model;
    return engine.modelToPdf(edited);
  } finally {
    doc.close();
  }
}

/**
 * Bake paragraph-style and/or list-level edits keyed by flat `source_index`.
 *
 * End-to-end native edit: open → toModel → resolve each edit's `source_index`
 * to its block address (via {@link buildSourceIndexAddrMap}) → emit
 * `setParagraphStyle` / `setList*` ops → applyModelOps → modelToPdf. A single
 * `toModel()` powers both the address resolution AND the op application, so the
 * addresses and the edited model are always consistent.
 *
 * Edits whose `source_index` does not resolve to a paragraph/heading block are
 * reported in `unresolved` and skipped (never throw).
 */
export async function applyParagraphOps(
  bytes: Buffer | Uint8Array | ArrayBuffer,
  edits: { paragraphs?: ParagraphStyleEdit[]; lists?: ListEdit[] },
): Promise<ApplyParagraphOpsResult> {
  const paragraphEdits = edits.paragraphs ?? [];
  const listEdits = edits.lists ?? [];

  const engine = await getEngine();
  const data =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes as ArrayBuffer);
  const doc = engine.open(data);
  try {
    const model = doc.toModel();
    const addrMap = buildSourceIndexAddrMap(model);

    const ops: ModelOp[] = [];
    const unresolved: number[] = [];
    // Dedupe paragraph ops by block address — the editor may dispatch one edit
    // per selected run, but they all share the same block. Last patch wins for a
    // given block, mirroring the editor's last-write-wins style semantics.
    const paragraphByBlock = new Map<AddrKey, { addr: GigaBlockAddr; patch: GigaParaPatch }>();

    for (const edit of paragraphEdits) {
      const addr = addrMap.get(edit.sourceIndex);
      if (!addr) {
        unresolved.push(edit.sourceIndex);
        continue;
      }
      const key = addrKey(addr);
      const prev = paragraphByBlock.get(key);
      // Merge patches targeting the same block so multiple field changes in one
      // batch (e.g. align + indent) collapse into a single op.
      paragraphByBlock.set(key, {
        addr,
        patch: prev ? { ...prev.patch, ...edit.patch } : edit.patch,
      });
    }
    for (const { addr, patch } of paragraphByBlock.values()) {
      ops.push({ op: 'setParagraphStyle', addr, patch });
    }

    for (const edit of listEdits) {
      const addr = addrMap.get(edit.sourceIndex);
      if (!addr) {
        unresolved.push(edit.sourceIndex);
        continue;
      }
      if (edit.kind === 'level') {
        ops.push({ op: 'setListLevel', addr, level: edit.level });
      } else if (edit.kind === 'marker') {
        ops.push({ op: 'setListMarker', addr, marker: edit.marker });
      } else {
        ops.push({ op: 'setListOrdered', addr, ordered: edit.ordered });
      }
    }

    const resolved = ops.length;
    if (resolved === 0) {
      // Nothing addressable — re-render the untouched model so the caller still
      // receives valid bytes (cheap, and keeps the contract uniform).
      engineLogger.debug('applyParagraphOps: no edits resolved to a block address', {
        unresolved,
      });
    }

    const edited = resolved > 0 ? engine.applyModelOps(model, ops) : model;
    const out = engine.modelToPdf(edited);
    return { bytes: out, resolved, unresolved };
  } finally {
    doc.close();
  }
}
