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
  GigaBorderStyle,
  GigaDocument,
  GigaInline,
  GigaListItem,
  GigaListMarker,
  GigaParaPatch,
  GigaRect,
  ModelOp,
} from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

// Re-export the lib's model-edit vocabulary so callers (routes, app layer) have
// a single import surface and never depend on the lib package directly.
export type {
  GigaBlockAddr,
  GigaBorderStyle,
  GigaDocument,
  GigaListMarker,
  GigaParaPatch,
  GigaRect,
  ModelOp,
} from '@qrcommunication/gigapdf-lib';

/**
 * An RGB triple in the engine's `0..=1` float channel space (mirror of the
 * lib's `[number, number, number]` colour), used by table cell shading and the
 * table border colour. `null` (where accepted) clears the colour/shading.
 */
export type RgbColor = [number, number, number];

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

/** Read the `{ items }` of a list block defensively (typed + runtime). */
function listItems(block: GigaBlock): GigaListItem[] {
  const v = block.kind?.v as { items?: unknown } | undefined;
  const items = v?.items;
  return Array.isArray(items) ? (items as GigaListItem[]) : [];
}

/** Read the nested `{ blocks }` of one list item defensively. */
function listItemBlocks(item: GigaListItem): GigaBlock[] {
  const blocks = (item as { blocks?: unknown }).blocks;
  return Array.isArray(blocks) ? (blocks as GigaBlock[]) : [];
}

/**
 * Collect every `source_index` reachable from a paragraph/heading block (and,
 * recursively, the nested paragraph/heading blocks of a list block). Used to
 * record which runs belong to a given LIST block so a list-level edit keyed by
 * a run's flat `source_index` resolves to the address of its enclosing list.
 */
function collectBlockSourceIndices(block: GigaBlock, out: number[]): void {
  const kind = block.kind?.t;
  if (kind === 'paragraph') {
    collectRunSourceIndices(paragraphRuns(block), out);
  } else if (kind === 'heading') {
    collectRunSourceIndices(headingRuns(block), out);
  } else if (kind === 'list') {
    for (const item of listItems(block)) {
      for (const nested of listItemBlocks(item)) {
        collectBlockSourceIndices(nested, out);
      }
    }
  }
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

/** Record `indices` against `addr` in `map`, first-writer-wins. */
function recordIndices(
  indices: number[],
  addr: GigaBlockAddr,
  map: Map<number, GigaBlockAddr>,
): void {
  for (const idx of indices) {
    // First writer wins — `source_index`es are unique per document in practice;
    // this guards against any accidental duplicate so the address stays stable.
    if (!map.has(idx)) map.set(idx, addr);
  }
}

/**
 * Record every `source_index` of the `block` against the address that accepts a
 * `setParagraphStyle` op for it. Paragraph and heading blocks map directly; a
 * LIST block is recursed so each nested paragraph's runs map to the nested
 * paragraph's own address (`[s, p, i, item, j]` if the engine addresses that
 * deeply — currently top-level only, so list-item paragraphs are addressed by
 * the list's `[s, p, i]` for paragraph ops, matching how the engine resolves
 * `setParagraphStyle` on a list). Other kinds (table/image/shape/...) are
 * addressed differently and skipped — consistent with the editor's run-level
 * grouping.
 */
function indexBlock(
  block: GigaBlock,
  addr: GigaBlockAddr,
  map: Map<number, GigaBlockAddr>,
): void {
  const kind = block.kind?.t;
  if (kind === 'paragraph') {
    const indices: number[] = [];
    collectRunSourceIndices(paragraphRuns(block), indices);
    recordIndices(indices, addr, map);
  } else if (kind === 'heading') {
    const indices: number[] = [];
    collectRunSourceIndices(headingRuns(block), indices);
    recordIndices(indices, addr, map);
  } else if (kind === 'list') {
    // A list-item paragraph isn't a separately-addressable top-level block, so
    // map its runs to the list block's address: `setParagraphStyle` applied to
    // a list block restyles its item paragraphs. Keeps list-item paragraph
    // formatting (align/indent/spacing/line-height) addressable from the flat
    // `source_index` the editor already holds.
    const indices: number[] = [];
    collectBlockSourceIndices(block, indices);
    recordIndices(indices, addr, map);
  }
}

/**
 * Record every `source_index` that belongs to a LIST block against that list
 * block's address — the seam for list-level edits (`setListLevel`/
 * `setListMarker`/`setListOrdered`), which address the list block itself, not
 * the nested item paragraph. A run inside a list item therefore resolves to its
 * enclosing list; a run in a plain paragraph is absent (not a list).
 */
function indexListBlock(
  block: GigaBlock,
  addr: GigaBlockAddr,
  map: Map<number, GigaBlockAddr>,
): void {
  if (block.kind?.t !== 'list') return;
  const indices: number[] = [];
  collectBlockSourceIndices(block, indices);
  recordIndices(indices, addr, map);
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
 * Build the `source_index → GigaBlockAddr` map for LIST blocks only.
 *
 * Walks `sections[s].pages[p].blocks[i]`; for each `list` block, every run
 * `source_index` reachable through its items maps to `[s, p, i]` (the list
 * block's own address). This is the seam for list-level edits — `setListLevel`/
 * `setListMarker`/`setListOrdered` target the list block, while the run the
 * editor selected lives in a nested item paragraph. Pure & deterministic; a run
 * outside any list is simply absent from the map.
 */
export function buildListAddrMap(
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
        if (block) indexListBlock(block, [s, p, i], map);
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
    // Paragraph ops resolve against paragraph/heading (and list-item paragraph)
    // blocks; list-level ops resolve against the ENCLOSING list block. Two maps,
    // one `toModel()` — addresses and the edited model stay consistent.
    const addrMap = buildSourceIndexAddrMap(model);
    const listAddrMap =
      listEdits.length > 0 ? buildListAddrMap(model) : null;

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
      // List-level ops target the list block (via listAddrMap), not the
      // paragraph block — a run in a list item resolves to its enclosing list.
      const addr = listAddrMap?.get(edit.sourceIndex);
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

// ─────────────────────────────────────────────────────────────────────────────
// Table structure bridge — add/remove rows & columns, addressed two ways
//
// A table is addressed POSITIONALLY by a stable `(pageNumber, tableIndexOnPage)`
// pair — the Nth `table` block on a page — which `listTablesInModel` enumerates
// (with the table's `GigaBlockAddr`, geometry, AND its cells). `applyTableOps`
// resolves that pair back to the table's `[section, page, index]` address and
// emits the matching structural {@link ModelOp}, then re-renders the model to PDF
// — a real "fat-library" bake + reload, identical in spirit to
// {@link applyParagraphOps}.
//
// CELL ADDRESSING via `source_index`. The engine now propagates each cell's first
// content-stream run index onto the cell's run (`GigaInlineRun.source_index`), so
// every non-empty cell is also reachable from a host's flat `source_index` space:
// `listTablesInModel` records each cell's `sourceIndices`, which the editor maps
// back to `(tableIndexOnPage, row, col)` — letting a CLICK on a cell select its
// table and target an insert/delete at that exact grid index, not just the edges.
// Empty cells carry no run index (addressable only by grid position).
// ─────────────────────────────────────────────────────────────────────────────

/** Read the `{ rows, col_widths }` body of a `table` block defensively. */
function tableBody(
  block: GigaBlock,
): { rows: unknown[]; colWidths: number[] } | null {
  if (block.kind?.t !== 'table') return null;
  const v = block.kind.v as { rows?: unknown; col_widths?: unknown } | undefined;
  const rows = v?.rows;
  if (!Array.isArray(rows)) return null;
  const colWidths = Array.isArray(v?.col_widths)
    ? (v!.col_widths as unknown[]).map((n) => (typeof n === 'number' ? n : 0))
    : [];
  return { rows, colWidths };
}

/**
 * Collect the `source_index`es of the runs inside a table cell's blocks. A cell
 * holds `blocks: GigaBlock[]` (typically one paragraph); each paragraph run that
 * carries a non-negative `source_index` contributes. Reads BOTH the flat
 * (`{t:'run', source_index}`) and runtime-wrapped (`{t:'run', v:{source_index}}`)
 * run shapes, mirroring {@link collectRunSourceIndices}. Empty / nested-only
 * cells yield `[]`.
 */
function cellSourceIndices(cellBlocks: unknown): number[] {
  const out: number[] = [];
  if (!Array.isArray(cellBlocks)) return out;
  for (const block of cellBlocks as GigaBlock[]) {
    const kind = block?.kind?.t;
    if (kind === 'paragraph') {
      collectRunSourceIndices(paragraphRuns(block), out);
    } else if (kind === 'heading') {
      collectRunSourceIndices(headingRuns(block), out);
    }
  }
  return out;
}

/**
 * One cell of a table, in row-major reading order: its 0-based grid position
 * (`row`, and `col` = the leftmost spanned grid column), its spans, and the
 * `source_index`es of its editable runs (empty for an empty cell). The editor
 * uses `sourceIndices` to resolve a clicked `TextElement.index` to this cell, and
 * `row`/`col` to target a row/column insert/delete at that exact grid index.
 */
export interface TableCellInfo {
  /** 0-based row index in the grid. */
  row: number;
  /** 0-based leftmost grid column the cell occupies (accounts for prior spans). */
  col: number;
  /** Columns this cell spans (≥ 1). */
  colSpan: number;
  /** Rows this cell spans (≥ 1). */
  rowSpan: number;
  /** Engine run indices of the cell's editable runs, in reading order. */
  sourceIndices: number[];
}

/**
 * Read a table block's cells into {@link TableCellInfo}[] (row-major). The grid
 * `col` of each cell is the running sum of prior cells' `col_span` in its row —
 * the same accumulation {@link tableColCount} uses — so a merged cell reports its
 * true leftmost column. Pure & defensive.
 */
function tableCells(rows: unknown[]): TableCellInfo[] {
  const cells: TableCellInfo[] = [];
  rows.forEach((rowRaw, rowIndex) => {
    const rowCells = (rowRaw as { cells?: unknown })?.cells;
    if (!Array.isArray(rowCells)) return;
    let col = 0;
    for (const cellRaw of rowCells as unknown[]) {
      const cell = cellRaw as {
        blocks?: unknown;
        col_span?: unknown;
        row_span?: unknown;
      };
      const colSpan =
        typeof cell.col_span === 'number' && cell.col_span >= 1
          ? cell.col_span
          : 1;
      const rowSpan =
        typeof cell.row_span === 'number' && cell.row_span >= 1
          ? cell.row_span
          : 1;
      cells.push({
        row: rowIndex,
        col,
        colSpan,
        rowSpan,
        sourceIndices: cellSourceIndices(cell.blocks),
      });
      col += colSpan;
    }
  });
  return cells;
}

/**
 * The number of grid columns a table spans, computed from the widest row's
 * cumulative `col_span` (falling back to `col_widths.length`). Mirrors the
 * editor's `tableStructure` so the reported `colCount` matches the renderer.
 */
function tableColCount(rows: unknown[], colWidths: number[]): number {
  let colCount = colWidths.length;
  for (const rowRaw of rows) {
    const cells = (rowRaw as { cells?: unknown })?.cells;
    if (!Array.isArray(cells)) continue;
    let col = 0;
    for (const cellRaw of cells) {
      const span = (cellRaw as { col_span?: unknown })?.col_span;
      col += typeof span === 'number' && span >= 1 ? span : 1;
    }
    colCount = Math.max(colCount, col);
  }
  return colCount;
}

/**
 * A table located in the unified model: its positional handle
 * (`pageNumber` + `tableIndexOnPage`), its resolved block address, the grid
 * dimensions and (when the engine provided one) its placement frame in PDF
 * user-space (origin bottom-left). The editor uses `frame` to draw a selectable
 * overlay and `pageNumber` + `tableIndexOnPage` to address an edit; the address
 * is included so the same enumeration powers both surfacing and baking.
 */
export interface TableInfo {
  /** 1-based page number (flattened page sequence, matching `TextElement` pages). */
  pageNumber: number;
  /** 0-based index of this table among the `table` blocks on its page. */
  tableIndexOnPage: number;
  /** Positional block address `[section, page, index]` of the table block. */
  addr: GigaBlockAddr;
  /** Number of grid rows. */
  rowCount: number;
  /** Number of grid columns (widest row's cumulative span). */
  colCount: number;
  /** Placement frame in PDF points (origin bottom-left), or `null` when the
   *  engine carried no frame for the block (the editor then has no overlay box). */
  frame: GigaRect | null;
  /** The cells in row-major order, each with its grid position, spans and the
   *  `source_index`es of its runs — for cell-level selection + precise insertion. */
  cells: TableCellInfo[];
}

/**
 * Enumerate every `table` block in the model, in page + reading order.
 *
 * Walks `sections[s].pages[p].blocks[i]` exactly like {@link buildSourceIndexAddrMap}
 * (so block addresses are consistent across both), counting the running page
 * number across sections (a section may hold many pages) so `pageNumber` matches
 * the 1-based page the editor's `TextElement`s use. Pure & deterministic.
 */
export function listTablesInModel(model: GigaDocument): TableInfo[] {
  const tables: TableInfo[] = [];
  const sections = Array.isArray(model.sections) ? model.sections : [];
  let pageNumber = 0; // 1-based, incremented as we cross every page in order
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    const pages = Array.isArray(section?.pages) ? section.pages : [];
    for (let p = 0; p < pages.length; p++) {
      pageNumber += 1;
      const page = pages[p];
      const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
      let tableIndexOnPage = 0;
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const body = block ? tableBody(block) : null;
        if (!body) continue;
        const frame =
          block!.frame && typeof block!.frame === 'object'
            ? (block!.frame as GigaRect)
            : null;
        tables.push({
          pageNumber,
          tableIndexOnPage,
          addr: [s, p, i],
          rowCount: body.rows.length,
          colCount: tableColCount(body.rows, body.colWidths),
          frame,
          cells: tableCells(body.rows),
        });
        tableIndexOnPage += 1;
      }
    }
  }
  return tables;
}

/**
 * Open a PDF and enumerate its tables ({@link listTablesInModel}) — the editor's
 * read path for surfacing selectable table overlays. Opens the document, lowers
 * it to the unified model, and returns the table list (positional handles +
 * addresses + grid sizes + frames). Never mutates the PDF.
 */
export async function listPdfTables(
  bytes: Buffer | Uint8Array | ArrayBuffer,
): Promise<TableInfo[]> {
  const engine = await getEngine();
  const data =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  const doc = engine.open(data);
  try {
    return listTablesInModel(doc.toModel());
  } finally {
    doc.close();
  }
}

/** A single table structural edit keyed by the table's positional handle. */
export type TableEdit =
  | {
      pageNumber: number;
      tableIndexOnPage: number;
      kind: 'insertRow' | 'deleteRow' | 'insertColumn' | 'deleteColumn';
      /** Grid position the op acts at (0-based; clamped engine-side). */
      at: number;
    }
  | {
      pageNumber: number;
      tableIndexOnPage: number;
      kind: 'setCellSpan';
      /** Row index in `rows`. */
      row: number;
      /** Cell index in `rows[row].cells` (not a grid column). */
      col: number;
      /** Columns the cell spans (clamped ≥ 1 engine-side). */
      colSpan: number;
      /** Rows the cell spans (clamped ≥ 1 engine-side). */
      rowSpan: number;
    }
  | {
      pageNumber: number;
      tableIndexOnPage: number;
      kind: 'setCellShading';
      /** Row index in `rows`. */
      row: number;
      /** Cell index in `rows[row].cells` (not a grid column). */
      col: number;
      /** RGB `0..=1` shading, or `null` to clear the cell's shading. */
      color: RgbColor | null;
    }
  | {
      pageNumber: number;
      tableIndexOnPage: number;
      kind: 'setRowHeight';
      /** Row index in `rows`. */
      row: number;
      /** Fixed row height in PDF points (clamped ≥ 0 engine-side). */
      height: number;
    }
  | {
      pageNumber: number;
      tableIndexOnPage: number;
      kind: 'setColWidth';
      /** Grid column index. */
      col: number;
      /** Fixed column width in PDF points (clamped ≥ 0 engine-side). */
      width: number;
    }
  | {
      pageNumber: number;
      tableIndexOnPage: number;
      kind: 'setTableBorder';
      /** The table/cell border: stroke `width` (points) + RGB `0..=1` `color`. */
      border: GigaBorderStyle;
    };

export interface ApplyTableOpsResult {
  /** PDF bytes re-rendered from the edited model. */
  bytes: Uint8Array;
  /** How many edits resolved to a table address and produced an op. */
  resolved: number;
  /** Edits whose `(pageNumber, tableIndexOnPage)` matched no table block. */
  unresolved: TableEdit[];
}

/** Map an enumerated table to a lookup key for `(page, tableIndexOnPage)`. */
type TableKey = `${number}:${number}`;
const tableKey = (pageNumber: number, tableIndexOnPage: number): TableKey =>
  `${pageNumber}:${tableIndexOnPage}`;

/** Translate a {@link TableEdit} + resolved address into a structural ModelOp. */
function tableEditToOp(edit: TableEdit, addr: GigaBlockAddr): ModelOp {
  switch (edit.kind) {
    case 'insertRow':
      return { op: 'insertTableRow', addr, at: edit.at };
    case 'deleteRow':
      return { op: 'deleteTableRow', addr, at: edit.at };
    case 'insertColumn':
      return { op: 'insertTableColumn', addr, at: edit.at };
    case 'deleteColumn':
      return { op: 'deleteTableColumn', addr, at: edit.at };
    case 'setCellSpan':
      return {
        op: 'setCellSpan',
        addr,
        row: edit.row,
        col: edit.col,
        col_span: edit.colSpan,
        row_span: edit.rowSpan,
      };
    case 'setCellShading':
      return {
        op: 'setCellShading',
        addr,
        row: edit.row,
        col: edit.col,
        color: edit.color,
      };
    case 'setRowHeight':
      return { op: 'setRowHeight', addr, row: edit.row, height: edit.height };
    case 'setColWidth':
      return { op: 'setColWidth', addr, col: edit.col, width: edit.width };
    case 'setTableBorder':
      return { op: 'setTableBorder', addr, border: edit.border };
  }
}

/**
 * Bake table structural & style edits (add/remove row or column, set a cell
 * span, shade a cell, size a row/column, restyle the table border) keyed by a
 * table's positional handle `(pageNumber, tableIndexOnPage)`.
 *
 * End-to-end native edit: open → toModel → enumerate tables ({@link listTablesInModel})
 * → resolve each edit's `(pageNumber, tableIndexOnPage)` to the table's
 * {@link GigaBlockAddr} → emit `insertTableRow` / `deleteTableRow` /
 * `insertTableColumn` / `deleteTableColumn` / `setCellSpan` / `setCellShading` /
 * `setRowHeight` / `setColWidth` / `setTableBorder` {@link ModelOp}s →
 * applyModelOps → modelToPdf. A single `toModel()` powers both the address
 * resolution AND the op application, so addresses and the edited model stay
 * consistent. Edits whose handle matches no table are reported in `unresolved`
 * and skipped (never throw).
 */
export async function applyTableOps(
  bytes: Buffer | Uint8Array | ArrayBuffer,
  edits: TableEdit[],
): Promise<ApplyTableOpsResult> {
  const engine = await getEngine();
  const data =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  const doc = engine.open(data);
  try {
    const model = doc.toModel();
    const tablesByKey = new Map<TableKey, GigaBlockAddr>();
    for (const table of listTablesInModel(model)) {
      // First-writer-wins guards against an unexpected duplicate handle so the
      // resolved address stays stable (handles are unique per page in practice).
      const key = tableKey(table.pageNumber, table.tableIndexOnPage);
      if (!tablesByKey.has(key)) tablesByKey.set(key, table.addr);
    }

    const ops: ModelOp[] = [];
    const unresolved: TableEdit[] = [];
    for (const edit of edits) {
      const addr = tablesByKey.get(
        tableKey(edit.pageNumber, edit.tableIndexOnPage),
      );
      if (!addr) {
        unresolved.push(edit);
        continue;
      }
      ops.push(tableEditToOp(edit, addr));
    }

    const resolved = ops.length;
    if (resolved === 0) {
      engineLogger.debug('applyTableOps: no edits resolved to a table address', {
        unresolved: unresolved.length,
      });
    }

    const edited = resolved > 0 ? engine.applyModelOps(model, ops) : model;
    const out = engine.modelToPdf(edited);
    return { bytes: out, resolved, unresolved };
  } finally {
    doc.close();
  }
}
