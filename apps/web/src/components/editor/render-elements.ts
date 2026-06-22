"use client";

/**
 * render-elements.ts
 *
 * SINGLE canonical renderer for parsed PDF elements (text / image / shape /
 * annotation / form_field) onto a Fabric.js canvas. The editable surface uses
 * THIS function — there is no second implementation:
 *
 *   - the single-page editor (`editor-canvas.tsx`) delegates to it; in the
 *     continuous Word-like view the ACTIVE page mounts the same `<EditorCanvas>`
 *     (embedded), so it goes through here too. Inactive pages in the continuous
 *     view render a read-only full raster (no overlay) via `page-canvas-host.tsx`.
 *
 * DIRECT-EDIT FIDELITY MODEL (what is visible vs a hit-target)
 * -----------------------------------------------------------
 * The visible page is the PDF rasterised at index 0 (the background image),
 * rendered by the editor WITHOUT the elements it overlays editably:
 *   - TEXT   — the raster omits ALL text (`renderPageNoText`); this overlay
 *     paints the REAL editable text on top (real colour + embedded font).
 *   - SHAPES — still drawn by the raster (it keeps every vector path 1:1, the
 *     visual ground truth); this overlay is a TRANSPARENT hit-target that
 *     reveals its real fill/stroke ONLY while selected (`attachShapeStyleReveal`)
 *     so the element stays editable without doubling the shape. Shapes are NOT
 *     excluded from the raster: `renderPageExcluding` honours shape exclusion
 *     only for some vector paths (engine index quirk) and mixing in the
 *     text-run ordinals over-excludes — both blanked whole coloured backgrounds.
 *   - IMAGES — still drawn by the raster; this overlay is an INVISIBLE
 *     (transparent) hit-target sitting exactly on top for click/move/resize.
 * Text is the only element repainted here, so nothing is drawn twice (no
 * "doubled text" bug). The original colours/styles are stashed on `obj.data.*`
 * for the selection-reveal, the properties panel and the layer-hide toggle.
 *
 * Dependencies that differ per surface (embedded-font resolution, edit-time
 * hide-mask, image URL resolution) are INJECTED via {@link RenderElementsOptions}
 * so the construction logic stays identical everywhere.
 */

import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import type * as FabricNamespace from "fabric";
import type { Element, PageBlockGroup } from "@giga-pdf/types";
import { clientLogger } from "@/lib/client-logger";

type FabricModule = typeof FabricNamespace;

// In the browser, never fall back to the internal dev URL (localhost:8000) —
// it leaks into the bundle when NEXT_PUBLIC_API_URL is unset at build time and
// gets blocked by CSP. Use the current origin (prod: https://giga-pdf.com).
// SSR/Node keeps the local Python default.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/** Metadata stockée dans obj.data pour tout objet rendu par cet utilitaire. */
export interface ElementObjectData {
  elementId?: string;
  type?: string;
  isPdfBackground?: boolean;
  /**
   * Engine UNIFIED element index (text run / image / vector path) carried from
   * the parsed element. Round-tripped back onto `element.index` by
   * `fabricObjectToElement` so the apply pipeline fires the lossless in-place
   * ops (`replaceText`/`transformElement`/`removeElement`) instead of redact+add.
   * Undefined for newly-added elements (no original engine element).
   */
  index?: number;
  /**
   * Original element rotation (degrees) at parse time. Compared against the
   * Fabric object's current `angle` to decide whether an image/shape in-place
   * edit can use an affine `transformElement` (rotation unchanged) or must fall
   * back to redact+add (rotation changed — affine can't express it here).
   */
  rotation0?: number;
  originalFont?: string | null;
  [key: string]: unknown;
}

interface FabricObjectWithData extends FabricObject {
  data?: ElementObjectData;
}

export interface RenderElementsOptions {
  /**
   * Facteur d'échelle conservé pour compatibilité d'API. La géométrie est
   * exprimée en points PDF natifs ; le zoom est appliqué via `canvas.setZoom()`
   * par l'appelant (single-page ET continu), donc ce paramètre n'est pas
   * réappliqué aux coordonnées ici.
   */
  scale?: number;
  /** Mode lecture seule : objets non sélectionnables / non interactifs. */
  readonly?: boolean;
  /** Callback déclenché à la sélection d'un élément (continu : panneaux page-scoped). */
  onElementSelected?: (elementId: string) => void;
  /**
   * Résout le nom de FontFace enregistré pour une police embarquée du PDF.
   * Injecté par l'appelant (hook `useEmbeddedFonts`). Sans lui, on retombe sur
   * `style.fontFamily` — sans incidence visuelle puisque l'overlay est invisible.
   */
  getFontFaceName?: (originalName: string) => string | null;
  /** Résout une URL d'image relative en URL absolue (défaut : API base URL). */
  resolveImageUrl?: (url: string) => string;
  /**
   * Masque le glyphe de fond sous un élément caché (edit-mode / re-render).
   * Optionnel : seul le single-page le fournit aujourd'hui.
   */
  applyHideMask?: (canvas: FabricCanvas, obj: FabricObject) => Promise<void>;
  /**
   * Regroupe les runs de texte d'un même paragraphe en UN bloc `Textbox`
   * multi-ligne éditable (édition « Word-like », à la Adobe) au lieu de N
   * `IText` ligne-par-ligne. Activé par défaut. Mettre à `false` pour revenir
   * au rendu ligne-par-ligne (utile pour le diagnostic / si un PDF se regroupe
   * mal). Le regroupement est CONSERVATEUR : en cas de doute un run reste un
   * `IText` séparé (cf. {@link groupTextRunsIntoParagraphs}).
   */
  groupParagraphs?: boolean;
  /**
   * Regroupement STRUCTUREL fourni par le moteur natif (`pageBlocks`) : la lib
   * est la source de vérité de la structure de lecture. Quand fourni (et
   * `groupParagraphs` non désactivé), les paragraphes/titres sont coalescés à
   * partir de CE découpage — chaque groupe liste les `source_index` (= l'index
   * moteur d'un run, identique à `TextElement.index`) de ses runs en ordre de
   * lecture — au lieu de l'heuristique positionnelle {@link
   * groupTextRunsIntoParagraphs}. Les runs sont résolus contre les `elements`
   * déjà parsés par leur `index` (bounds/style/police embarquée corrects), donc
   * le chemin de sauvegarde lossless (`data.paragraphRuns` → `replaceText`) est
   * réutilisé tel quel. Absent ⇒ repli sur l'heuristique (aucune régression).
   */
  blockGroups?: PageBlockGroup[];
}

// ---------------------------------------------------------------------------
// Helpers internes (purs)
// ---------------------------------------------------------------------------

/** Préfixe l'API base URL pour les chemins relatifs ; passe les absolus/data. */
function defaultResolveImageUrl(url: string): string {
  if (!url) return "";
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:")
  ) {
    return url;
  }
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Incruste une valeur alpha dans une couleur hex/rgb. Utilisé pour fill/stroke
 * de shape afin de préserver des opacités mixtes. Passe-through pour
 * transparent / chaînes vides.
 */
function colorWithAlpha(color: string, alpha: number): string {
  if (!color || color === "transparent" || color === "none") return "transparent";
  const a = Math.max(0, Math.min(1, alpha ?? 1));
  if (a >= 0.999) return color;
  const hex = color.trim();
  if (hex.startsWith("#")) {
    let r = 0,
      g = 0,
      b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1]! + hex[1]!, 16);
      g = parseInt(hex[2]! + hex[2]!, 16);
      b = parseInt(hex[3]! + hex[3]!, 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      return color;
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (hex.startsWith("rgb(")) {
    return hex.replace(/^rgb\(/, "rgba(").replace(/\)$/, `, ${a})`);
  }
  return color;
}

// ---------------------------------------------------------------------------
// Form-field overlay helpers (purs)
// ---------------------------------------------------------------------------

const FIELD_FILL_BY_TYPE: Record<string, string> = {
  text: "rgba(0, 100, 255, 0.08)",
  checkbox: "rgba(0, 180, 0, 0.10)",
  radio: "rgba(0, 180, 0, 0.10)",
  dropdown: "rgba(100, 0, 255, 0.08)",
  listbox: "rgba(100, 0, 255, 0.08)",
  signature: "rgba(255, 100, 0, 0.10)",
  button: "rgba(50, 50, 50, 0.10)",
};

const FIELD_STROKE_BY_TYPE: Record<string, string> = {
  text: "#0066cc",
  checkbox: "#00aa00",
  radio: "#00aa00",
  dropdown: "#6600cc",
  listbox: "#6600cc",
  signature: "#ff6600",
  button: "#333333",
};

/** Light translucent background tint for a form-field overlay, by field type. */
function fieldOverlayFill(fieldType: string): string {
  return FIELD_FILL_BY_TYPE[fieldType] ?? "rgba(0, 100, 255, 0.08)";
}

/** Border colour for a form-field overlay, by field type. */
function fieldOverlayStroke(fieldType: string): string {
  return FIELD_STROKE_BY_TYPE[fieldType] ?? "#0066cc";
}

/**
 * The display string for a text/dropdown field value. FormFieldElement.value is
 * `string | boolean | string[]`; coerce to a single line for the IText overlay.
 */
function formFieldTextValue(value: string | boolean | string[]): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return value ? "true" : "";
}

/**
 * Whether a checkbox/radio field is currently checked, from its value. Checkbox
 * uses a boolean (or the strings "on"/"off"/"yes"); radio is checked when its
 * value matches one of its option export values (non-empty).
 */
function formFieldChecked(field: {
  fieldType: string;
  value: string | boolean | string[];
  options: string[] | null;
}): boolean {
  const { value } = field;
  if (typeof value === "boolean") return value;
  if (field.fieldType === "checkbox") {
    const v = formFieldTextValue(value).toLowerCase();
    return v === "true" || v === "on" || v === "yes" || v === "1";
  }
  // radio: checked when a non-empty option is selected.
  return formFieldTextValue(value).length > 0;
}

// ---------------------------------------------------------------------------
// Paragraph grouping (Word-like editing) — pure helpers
// ---------------------------------------------------------------------------

type TextRun = Extract<Element, { type: "text" }>;

/**
 * Minimal snapshot of a source text run, stashed on the paragraph Textbox's
 * `data.paragraphRuns` so the save path can DECOMPOSE the multi-line block back
 * into the individual runs it came from (preserving each run's engine `index`,
 * `elementId`, exact `bounds` and `style`). This is what makes a coalesced
 * paragraph round-trip losslessly through `fabricObjectToElements`.
 */
export interface ParagraphRun {
  elementId: string;
  /** Engine text-run index (lossless `replaceText`); undefined if absent. */
  index?: number;
  bounds: { x: number; y: number; width: number; height: number };
  content: string;
}

/** A detected paragraph: 2+ vertically-stacked text runs sharing a style. */
export interface ParagraphGroup {
  /** The source runs, ordered top→bottom. */
  runs: TextRun[];
}

/** Normalised colour key for "same style" comparison. */
function colourKeyOf(t: TextRun): string {
  return (t.style.color || "#000000").trim().toLowerCase();
}

/**
 * Two runs share the SAME visual style (so they may belong to one paragraph):
 * same family + same embedded subset identity (`originalFont`), font sizes
 * within ±10%, same colour, same weight/style and same horizontal alignment.
 * A style break (e.g. a bold lead-in line, a differently-coloured note) ends
 * the paragraph — exactly what a real editor does.
 */
function sameParagraphStyle(a: TextRun, b: TextRun): boolean {
  const fsA = a.style.fontSize || 0;
  const fsB = b.style.fontSize || 0;
  if (fsA <= 0 || fsB <= 0) return false;
  const ratio = fsA > fsB ? fsA / fsB : fsB / fsA;
  if (ratio > 1.1) return false; // sizes differ by more than 10%
  if ((a.style.fontFamily || "") !== (b.style.fontFamily || "")) return false;
  if ((a.style.originalFont || "") !== (b.style.originalFont || "")) return false;
  if (colourKeyOf(a) !== colourKeyOf(b)) return false;
  if ((a.style.fontWeight || "normal") !== (b.style.fontWeight || "normal")) {
    return false;
  }
  if ((a.style.fontStyle || "normal") !== (b.style.fontStyle || "normal")) {
    return false;
  }
  if ((a.style.textAlign || "left") !== (b.style.textAlign || "left")) {
    return false;
  }
  return true;
}

/** Horizontal intervals [x, x+width] of the two runs overlap by ≥ minOverlap px. */
function horizontallyOverlap(a: TextRun, b: TextRun, minOverlap: number): boolean {
  const aL = a.bounds.x;
  const aR = a.bounds.x + a.bounds.width;
  const bL = b.bounds.x;
  const bR = b.bounds.x + b.bounds.width;
  return Math.min(aR, bR) - Math.max(aL, bL) >= minOverlap;
}

/**
 * `next` continues the paragraph started by `prev` (the previous line) iff ALL
 * of these hold — deliberately strict so we never merge things that are not a
 * paragraph (titles, form labels, table cells, separate columns):
 *
 *   - same visual style (see {@link sameParagraphStyle});
 *   - left edges aligned within `xTol` (left-aligned / justified body text);
 *   - a REGULAR descending line gap: `next` sits BELOW `prev` and the baseline
 *     step is between ~0.8×fontSize (no overlap) and ~1.8×(fontSize·lineHeight)
 *     (no large jump = new block / blank line);
 *   - the two runs share a horizontal span (same column, not side-by-side).
 *
 * Hyperlinks (linkUrl/linkPage) and RTL runs are never merged (handled by the
 * caller) — wrapping/decoration there is too easy to get wrong.
 */
function continuesParagraph(prev: TextRun, next: TextRun): boolean {
  if (!sameParagraphStyle(prev, next)) return false;

  const fontSize = prev.style.fontSize || 12;
  const lineHeight = prev.style.lineHeight && prev.style.lineHeight > 0
    ? prev.style.lineHeight
    : 1.2;

  // Left edges close (paragraph indentation is consistent line-to-line).
  const xTol = Math.max(2, fontSize * 0.5);
  if (Math.abs(next.bounds.x - prev.bounds.x) > xTol) return false;

  // Descending, regular line gap (top-left Y, axis points downward).
  const gap = next.bounds.y - prev.bounds.y;
  const minGap = fontSize * 0.8;
  const maxGap = fontSize * lineHeight * 1.8;
  if (gap < minGap || gap > maxGap) return false;

  // Same column (significant horizontal overlap), not two side-by-side runs.
  const minOverlap = Math.min(prev.bounds.width, next.bounds.width) * 0.4;
  if (!horizontallyOverlap(prev, next, Math.max(1, minOverlap))) return false;

  return true;
}

/** A run that must NEVER be folded into a paragraph (kept as its own IText). */
function isUngroupableRun(t: TextRun): boolean {
  if (t.linkUrl || t.linkPage) return true; // keep links standalone (underline/click)
  if (t.style.direction === "rtl") return true; // RTL wrapping is delicate
  if (!t.content || t.content.includes("\n")) return true; // empty / already multi-line
  return false; // otherwise groupable
}

/**
 * Group consecutive same-style, regularly-spaced, left-aligned text runs into
 * paragraphs. Returns BOTH the detected paragraph groups (2+ runs) AND the runs
 * that stay standalone. Pure & deterministic — drives the renderer and is unit
 * tested in isolation.
 *
 * Conservative by design: a single line, a style change, an irregular gap, a
 * column change, a link or an RTL run all CLOSE the current paragraph. A false
 * merge is worse than no merge, so when in doubt a run is left on its own.
 */
export function groupTextRunsIntoParagraphs(elements: Element[]): {
  paragraphs: ParagraphGroup[];
  standalone: TextRun[];
} {
  const runs = elements.filter((e): e is TextRun => e.type === "text");
  // Top→bottom, then left→right, so paragraph lines are visited in reading order.
  const ordered = [...runs].sort((a, b) => {
    const dy = a.bounds.y - b.bounds.y;
    if (Math.abs(dy) > 0.5) return dy;
    return a.bounds.x - b.bounds.x;
  });

  const paragraphs: ParagraphGroup[] = [];
  const standalone: TextRun[] = [];
  const consumed = new Set<TextRun>();

  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i]!;
    if (consumed.has(start)) continue;
    if (isUngroupableRun(start)) {
      standalone.push(start);
      consumed.add(start);
      continue;
    }
    // Greedily extend the paragraph downward from `start`.
    const group: TextRun[] = [start];
    consumed.add(start);
    let prev = start;
    for (let j = i + 1; j < ordered.length; j++) {
      const cand = ordered[j]!;
      if (consumed.has(cand)) continue;
      if (isUngroupableRun(cand)) continue;
      if (continuesParagraph(prev, cand)) {
        group.push(cand);
        consumed.add(cand);
        prev = cand;
      }
      // Do NOT break on first non-match: a later run could still be the next
      // line if an unrelated run interleaved in the sort. But once the vertical
      // gap to the LAST paragraph line is exceeded, stop scanning (perf + safety).
      else if (cand.bounds.y - prev.bounds.y > (prev.style.fontSize || 12) * (prev.style.lineHeight || 1.2) * 1.8) {
        break;
      }
    }
    if (group.length >= 2) {
      paragraphs.push({ runs: group });
    } else {
      standalone.push(start);
    }
  }

  return { paragraphs, standalone };
}

/**
 * Coalesce paragraphs/headings from the native engine's STRUCTURAL grouping
 * (the lib is the source of reading structure) instead of the positional
 * heuristic. Each {@link PageBlockGroup} lists the engine `source_index`es of a
 * paragraph/heading block's runs in reading order; those map 1:1 onto
 * `TextElement.index`, so we resolve each run from the page's ALREADY-PARSED
 * text elements (keeping their exact bounds, style and embedded-font identity)
 * and assemble a {@link ParagraphGroup}. The resulting groups feed the same
 * Textbox render + `data.paragraphRuns` lossless decompose-save path as the
 * heuristic — the lib only decides WHICH runs group together.
 *
 * Pure & deterministic. Robust to drift between the lib grouping and the parsed
 * elements: an index with no matching text run (or already consumed) is skipped,
 * and a group that ends up with < 2 resolvable runs is dropped (its lone run, if
 * any, stays a standalone IText — identical to the no-grouping behaviour).
 *
 * @param elements   The page's flat scene-graph elements (text + others).
 * @param blockGroups The engine block grouping for the page.
 * @returns Detected paragraph groups (≥ 2 runs) + the text runs left standalone.
 */
export function pageBlockGroupsToParagraphs(
  elements: Element[],
  blockGroups: PageBlockGroup[],
): { paragraphs: ParagraphGroup[]; standalone: TextRun[] } {
  // Index the page's text runs by their engine index for O(1) lookup. A run
  // without an `index` (newly added, or non-editable form-XObject sentinel) is
  // not addressable by the lib grouping and stays standalone.
  const runByIndex = new Map<number, TextRun>();
  const allRuns: TextRun[] = [];
  for (const el of elements) {
    if (el.type !== "text") continue;
    const run = el as TextRun;
    allRuns.push(run);
    if (typeof run.index === "number" && run.index >= 0) {
      // First run wins for a given index (indices are unique per page in
      // practice; this guards against any accidental duplicate).
      if (!runByIndex.has(run.index)) runByIndex.set(run.index, run);
    }
  }

  const paragraphs: ParagraphGroup[] = [];
  const consumed = new Set<TextRun>();

  for (const group of blockGroups) {
    if (group.kind !== "paragraph" && group.kind !== "heading") continue;
    const runs: TextRun[] = [];
    for (const sourceIndex of group.sourceIndices) {
      const run = runByIndex.get(sourceIndex);
      // Skip a missing index, an already-consumed run (defensive against a run
      // claimed by two blocks), and ungroupable runs (links/RTL/multi-line) so
      // they keep their dedicated standalone rendering.
      if (!run || consumed.has(run) || isUngroupableRun(run)) continue;
      runs.push(run);
      consumed.add(run);
    }
    if (runs.length >= 2) {
      paragraphs.push({ runs });
    } else {
      // A block that resolved to a single run is not worth a Textbox — release
      // its run so it renders as a standalone IText below.
      for (const r of runs) consumed.delete(r);
    }
  }

  const standalone = allRuns.filter((r) => !consumed.has(r));
  return { paragraphs, standalone };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Rend tous les éléments parsés en objets Fabric.js (invisibles, hit-targets)
 * sur le canvas donné. Le rendu est identique pour le single-page et le continu.
 */
export async function renderElementsOverlay(
  canvas: FabricCanvas,
  elements: Element[],
  fabricModule: FabricModule,
  options: RenderElementsOptions = {},
): Promise<void> {
  const {
    scale = 1,
    readonly = false,
    onElementSelected,
    getFontFaceName,
    resolveImageUrl = defaultResolveImageUrl,
    applyHideMask,
    groupParagraphs = true,
    blockGroups,
  } = options;
  // Géométrie en points natifs : le zoom est géré par canvas.setZoom().
  void scale;

  const {
    Rect,
    Circle,
    Ellipse,
    Triangle,
    Line,
    IText,
    Textbox,
    FabricImage,
    Path: FabricPath,
    Polygon,
  } = fabricModule;

  // Collect image-load promises to await them all before the final renderAll
  const imageLoadPromises: Promise<void>[] = [];

  // 1. SORT BY Z-ORDER LAYER: shapes (background fills, banner rectangles)
  //    must render BEHIND text and images. Without this, a red banner shape
  //    extracted later in the parser ends up on top of its own text label,
  //    making it unreadable. Layer order: shape < image < text < annotation < form_field.
  const layerRank: Record<string, number> = {
    shape: 0,
    image: 1,
    draw: 2,
    text: 3,
    annotation: 4,
    form_field: 5,
  };
  const sortedElements = [...elements].sort((a, b) => {
    const ra = layerRank[a.type] ?? 99;
    const rb = layerRank[b.type] ?? 99;
    return ra - rb;
  });

  // 2. DEDUPLICATE near-identical text runs. PDFs sometimes render the
  //    same string twice — generators do this for shadow/relief effects,
  //    or because they layer a vector outline (custom font) above an
  //    invisible selectable-text trace (system font fallback). Both
  //    cases produce two stacked IText objects in our scene graph; the
  //    user sees a doubled title and clicking one selects the wrong
  //    layer.
  //
  //    The signature deliberately ignores fontFamily because the duplicate
  //    typically uses a different family (embedded outline vs Helvetica
  //    fallback). Matching on content + rounded fontSize + tight position
  //    (≤2px on BOTH axes) is enough — wider tolerance kills legitimate
  //    repeats.
  //
  //    DEDUPE RULE (single, conservative): drop the second occurrence ONLY
  //    when it is a true shadow/outline twin — same content + same colour +
  //    within 2px on BOTH the X AND Y axes. A real shadow/relief or
  //    vector-outline-over-trace duplicate sits within sub-pixel of its
  //    twin, so 2px covers it.
  //
  //    Anything farther apart on EITHER axis is a legitimate distinct run
  //    and MUST be kept. This includes:
  //      - cross-line repeats ("RONY LICHA" on sender + recipient lines:
  //        same y, offset x),
  //      - same-column repeats at different rows (form field labels, table
  //        cells, repeated values like "Les Lilas" down a column: same x,
  //        different y).
  //    A previous heuristic also dropped "same X (≤3px) + ANY Y" to catch a
  //    form save-loop re-render; that over-suppressed legitimate column
  //    repeats on real forms (whole runs vanished from the editor), so it is
  //    removed — the save-loop case is now handled upstream (the overlay is
  //    no longer baked back as a second text run) and never warrants killing
  //    a run that differs in Y.
  //
  //    Colour is part of the signature so a white "6,99€" on a red banner
  //    does not get killed by a black drop-shadow twin that appeared first
  //    in the parser stream.
  const seenTextSignatures = new Map<string, Array<{ x: number; y: number }>>();
  const dedupedElements = sortedElements.filter((el) => {
    if (el.type !== "text") return true;
    const textElement = el as Extract<Element, { type: "text" }>;
    const colourKey = (textElement.style.color || "#000000").toLowerCase();
    const sig = `${textElement.content}|${Math.round(textElement.style.fontSize)}|${colourKey}`;
    const positions = seenTextSignatures.get(sig);
    const here = { x: textElement.bounds.x, y: textElement.bounds.y };
    if (!positions) {
      seenTextSignatures.set(sig, [here]);
      return true;
    }
    // True shadow/outline twin ONLY: same content + colour, within 2px on
    // BOTH axes. Different X or different Y → legitimate distinct run, keep.
    const isShadowTwin = positions.some((p) => {
      const dx = Math.abs(p.x - here.x);
      const dy = Math.abs(p.y - here.y);
      return dx <= 2 && dy <= 2;
    });
    if (isShadowTwin) return false;
    positions.push(here);
    return true;
  });

  // 3. GROUP TEXT RUNS INTO PARAGRAPHS (Word-like editing). Consecutive runs of
  //    a paragraph/heading are coalesced into one multi-line `Textbox` (like
  //    Adobe grouping an intro paragraph into one editable block) instead of N
  //    IText. The grouping comes from the native engine's `pageBlocks` when the
  //    caller supplies `blockGroups` (the lib = source of structure); otherwise
  //    it falls back to the positional heuristic. Either way the folded runs are
  //    excluded from the per-line IText loop below (tracked by elementId) and
  //    rendered as Textboxes afterwards, and both paths produce the SAME
  //    ParagraphGroup shape → identical lossless decompose-save. Conservative —
  //    a title / label / table cell / column / link stays its own IText.
  const paragraphGroups = !groupParagraphs
    ? []
    : blockGroups && blockGroups.length > 0
      ? pageBlockGroupsToParagraphs(dedupedElements, blockGroups).paragraphs
      : groupTextRunsIntoParagraphs(dedupedElements).paragraphs;
  const runsInParagraph = new Set<string>();
  for (const group of paragraphGroups) {
    for (const run of group.runs) runsInParagraph.add(run.elementId);
  }

  for (const element of dedupedElements) {
    // Guard: skip elements with missing or zero-size bounds
    if (
      !element.bounds ||
      element.bounds.width <= 0 ||
      element.bounds.height <= 0
    ) {
      continue;
    }

    // A text run folded into a paragraph is rendered as part of its Textbox
    // (below), never as a standalone IText — skip it here.
    if (element.type === "text" && runsInParagraph.has(element.elementId)) {
      continue;
    }

    const baseOptions = {
      left: element.bounds.x,
      top: element.bounds.y,
      // Fabric 6.x defaults to originX/Y: 'center' which treats left/top as
      // the OBJECT CENTER. Parser produces top-left coords, so force origin
      // to 'left'/'top' to avoid visual offset of width/2, height/2.
      originX: "left" as const,
      originY: "top" as const,
      angle: element.transform?.rotation || 0,
      selectable: !element.locked && !readonly,
      evented: !element.locked && !readonly,
      visible: element.visible,
    };

    let fabricObj: FabricObject | null = null;

    switch (element.type) {
      case "text": {
        const textElement = element;
        // Resolved colour (kept on .data so edit mode can restore it)
        const textColour = textElement.style.color || "#000000";
        // pdf-engine text-extractor stores bounds.{x,y} at the TOP-LEFT
        // of the glyph bbox (= baseline - fontSize approximated as ascender).
        // For Fabric's baseline to land on the PDF baseline (= bounds.y +
        // fontSize), use originY='bottom' with top = bounds.y + fontSize +
        // descender. Without the descender (~22% of fontSize), Fabric
        // would put its bbox bottom (= baseline + descender) at the PDF
        // baseline, overshooting by descender — visible as a "léger
        // décalage vers le bas" of the editable overlay.
        const _fontSize = textElement.style.fontSize ?? 12;
        const _descenderOffset = _fontSize * 0.22;
        const _baselineY = textElement.bounds.y + _fontSize;
        // Resolve the embedded PDF font first. When it resolves, the registered
        // FontFace already IS the correct weight/style variant of the subset, so
        // applying a synthetic bold/italic ON TOP widens the glyphs and the text
        // overflows / collides with its neighbours. We therefore neutralise the
        // synthetic weight/style whenever the embedded font is used, and only
        // honour the parsed weight/style for the generic CSS fallback (where the
        // family carries no built-in variant).
        const _embeddedFontName = (() => {
          const orig = textElement.style.originalFont;
          if (orig && getFontFaceName) {
            const registered = getFontFaceName(orig);
            if (registered) return registered;
          }
          return null;
        })();
        const _usingEmbeddedFont = _embeddedFontName !== null;
        const _resolvedFontFamily =
          _embeddedFontName ?? textElement.style.fontFamily ?? "Helvetica";
        const textObj = new IText(textElement.content || "", {
          ...baseOptions,
          top: _baselineY + _descenderOffset,
          originY: "bottom" as const,
          width: textElement.bounds.width,
          fontSize: _fontSize,
          fontFamily: _resolvedFontFamily,
          // Embedded subset = already the right variant → no synthetic bold/italic.
          fontWeight: _usingEmbeddedFont
            ? "normal"
            : textElement.style.fontWeight || "normal",
          fontStyle: _usingEmbeddedFont
            ? "normal"
            : textElement.style.fontStyle || "normal",
          // DIRECT-TEXT model: the page background is rasterised WITHOUT text
          // (engine `renderPageNoText`), so this overlay IS the visible text —
          // rendered in its REAL colour and embedded font. No colour mask is
          // ever needed (nothing underneath), so editing works on any
          // background (gradients included). data.originalFill keeps the colour
          // for the properties panel / layer-hide toggle.
          fill: textColour,
          opacity: textElement.style.opacity ?? 1,
          textAlign: textElement.style.textAlign || "left",
          lineHeight: textElement.style.lineHeight || 1.2,
          charSpacing: (textElement.style.letterSpacing || 0) * 10,
          underline: textElement.style.underline || false,
          linethrough: textElement.style.strikethrough || false,
          textBackgroundColor: "",
          cursorColor: textColour,
          cursorWidth: 1,
          // Selection visuals stay subtle so we don't pollute the page
          selectionColor: "rgba(0, 100, 200, 0.18)",
          // Selected state must be visually obvious — without a visible
          // border + controls the user clicks the title and sees nothing
          // change, then concludes "the editor is broken". Fabric only
          // draws border/controls when the object is the active target,
          // so this stays clean for the unselected glyphs.
          hasControls: true,
          hasBorders: true,
          borderColor: "rgba(0, 100, 200, 0.75)",
          borderScaleFactor: 1,
          cornerColor: "rgb(0, 100, 200)",
          cornerStrokeColor: "#ffffff",
          cornerSize: 8,
          transparentCorners: false,
        });
        // No anti-overflow scaleX fit. Per the user directive ("use the embedded
        // font, no scaleX that squashes the text"), the run keeps its NATURAL
        // width. With the embedded PDF font resolved (the common case) the real
        // metrics already make the text fit its bounds. If a font truly fails to
        // load, the fallback may render slightly wider than bounds.width and
        // overflow a little — that is the accepted trade-off over squashing the
        // glyphs horizontally.
        (textObj as FabricObjectWithData).data = {
          elementId: textElement.elementId,
          type: "text",
          // Engine text-run index → lossless in-place replaceText/moveElement.
          index: textElement.index,
          rotation0: textElement.transform?.rotation ?? 0,
          originalFont: textElement.style.originalFont,
          // True when the embedded PDF font was resolved & registered — the
          // overlay then renders with the SAME typography as the original, so no
          // synthetic weight/style is applied.
          usingEmbeddedFont: _usingEmbeddedFont,
          originalFill: textColour,
          originalBgColor: textElement.style.backgroundColor || "",
          linkUrl: textElement.linkUrl,
          linkPage: textElement.linkPage,
        };
        // Style hyperlinks
        if (
          (textElement.linkUrl || textElement.linkPage) &&
          !textElement.style.underline
        ) {
          textObj.set({ underline: true });
        }
        fabricObj = textObj as unknown as FabricObject;
        break;
      }

      case "image": {
        const imgElement = element;
        if (imgElement.source?.dataUrl) {
          const imageUrl = resolveImageUrl(imgElement.source.dataUrl);
          const originalWidth =
            imgElement.source.originalDimensions?.width ||
            imgElement.bounds.width;
          const originalHeight =
            imgElement.source.originalDimensions?.height ||
            imgElement.bounds.height;
          const targetScaleX = imgElement.bounds.width / (originalWidth || 1);
          const targetScaleY = imgElement.bounds.height / (originalHeight || 1);

          const loadPromise = FabricImage.fromURL(imageUrl, {
            crossOrigin: "anonymous",
          })
            .then((img: FabricObject) => {
              img.set({
                ...baseOptions,
                scaleX: targetScaleX,
                scaleY: targetScaleY,
                opacity: imgElement.style?.opacity ?? 1,
              });
              (img as FabricObjectWithData).data = {
                elementId: imgElement.elementId,
                type: "image",
                // Engine unified element index → lossless in-place
                // transformElement (move/resize) / removeElement (delete).
                index: imgElement.index,
                rotation0: imgElement.transform?.rotation ?? 0,
              };
              canvas.add(img);
            })
            .catch((err) => {
              clientLogger.error(
                "[renderElements] Failed to load image element:",
                imgElement.elementId,
                err,
              );
            });
          imageLoadPromises.push(loadPromise);
        }
        break;
      }

      case "shape": {
        const shapeElement = element;
        const hasStroke =
          shapeElement.style.strokeColor && shapeElement.style.strokeWidth > 0;
        const hasFill = !!shapeElement.style.fillColor;
        // RASTER-TRUTH shape model: the source PDF's shapes (section fills,
        // coloured banners, field backgrounds…) stay BAKED in the text-free
        // raster background (`renderPageNoText`, index 0), so what the user sees
        // is pixel-exact — including the PDF's own z-order subtleties (e.g. a
        // white input box inset over a coloured frame, anti-aliased borders).
        // This Fabric overlay is therefore a TRANSPARENT, editable hit-target:
        // it carries the real fill/stroke on `data.*`, is revealed on selection
        // (see `attachShapeStyleReveal`) and is the object the move/resize/
        // restyle pipeline edits. We do NOT repaint shapes here, because the
        // engine's `renderPageExcluding` honours shape exclusion only for some
        // vector paths, so painting a visible overlay over an inconsistently
        // excluded raster left whole coloured backgrounds blank.
        const fillCss = hasFill
          ? colorWithAlpha(
              shapeElement.style.fillColor as string,
              shapeElement.style.fillOpacity ?? 1,
            )
          : "transparent";
        const strokeCss = hasStroke
          ? colorWithAlpha(
              shapeElement.style.strokeColor as string,
              shapeElement.style.strokeOpacity ?? 1,
            )
          : "transparent";
        const shapeOptions = {
          ...baseOptions,
          // Transparent in view (the raster shows the real shape); data.* keeps
          // the real values so selection-reveal / the properties panel restore
          // them, and the strokeDashArray is carried for the reveal too.
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 0,
          ...(shapeElement.style.strokeDashArray &&
          shapeElement.style.strokeDashArray.length > 0
            ? { strokeDashArray: [...shapeElement.style.strokeDashArray] }
            : {}),
          opacity: 1,
          // Make the selected state obvious — same rationale as text overlays.
          hasControls: true,
          hasBorders: true,
          borderColor: "rgba(0, 100, 200, 0.75)",
          cornerColor: "rgb(0, 100, 200)",
          cornerStrokeColor: "#ffffff",
          cornerSize: 8,
          transparentCorners: false,
        };
        const w = shapeElement.bounds.width;
        const h = shapeElement.bounds.height;

        switch (shapeElement.shapeType) {
          case "rectangle":
            fabricObj = new Rect({
              ...shapeOptions,
              width: w,
              height: h,
              rx: shapeElement.geometry?.cornerRadius || 0,
              ry: shapeElement.geometry?.cornerRadius || 0,
            });
            break;
          case "circle":
            fabricObj = new Circle({ ...shapeOptions, radius: w / 2 });
            break;
          case "ellipse":
            fabricObj = new Ellipse({ ...shapeOptions, rx: w / 2, ry: h / 2 });
            break;
          case "line":
          case "arrow":
            fabricObj = new Line([0, 0, w, 0], shapeOptions);
            break;
          case "triangle":
            fabricObj = new Triangle({ ...shapeOptions, width: w, height: h });
            break;
          case "polygon": {
            // fabric.Polygon needs an explicit points array. We have it on
            // geometry.points (already in canvas coords).
            const pts = shapeElement.geometry?.points ?? [];
            if (pts.length >= 3) {
              fabricObj = new Polygon(pts, shapeOptions);
            } else {
              fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
            }
            break;
          }
          case "path":
          default: {
            // Render via SVG pathData when available — required for any
            // shape with Bezier curves (logos, icons, complex outlines).
            // Falling back to Rect would render a meaningless filled box.
            const pathData = shapeElement.geometry?.pathData;
            if (pathData) {
              // Fabric.Path positions itself at the path's own bounding box
              // top-left, then offsets via left/top. Pass the bounds origin
              // explicitly so the path keeps its absolute canvas position.
              fabricObj = new FabricPath(pathData, {
                ...shapeOptions,
                left: shapeElement.bounds.x,
                top: shapeElement.bounds.y,
                originX: "left",
                originY: "top",
              });
            } else {
              fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
            }
          }
        }
        if (fabricObj) {
          (fabricObj as FabricObjectWithData).data = {
            elementId: shapeElement.elementId,
            type: "shape",
            // Engine unified element index → lossless in-place
            // transformElement (move/resize) / removeElement (delete).
            index: shapeElement.index,
            rotation0: shapeElement.transform?.rotation ?? 0,
            originalFill: hasFill ? fillCss : null,
            originalStroke: hasStroke ? strokeCss : null,
            originalStrokeWidth: hasStroke ? shapeElement.style.strokeWidth : 0,
            // Carried so selection-reveal restores the dash pattern too.
            originalStrokeDashArray:
              shapeElement.style.strokeDashArray &&
              shapeElement.style.strokeDashArray.length > 0
                ? [...shapeElement.style.strokeDashArray]
                : null,
          };
        }
        break;
      }

      case "annotation": {
        const annoElement = element;
        const annoOptions = {
          ...baseOptions,
          opacity: annoElement.style?.opacity ?? 1,
        };
        const annoWidth = annoElement.bounds.width;
        const annoHeight = annoElement.bounds.height;
        const annoColor = annoElement.style?.color || "#ff0000";

        switch (annoElement.annotationType) {
          case "highlight":
            fabricObj = new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(255, 255, 0, 0.3)",
              stroke: "transparent",
            });
            break;
          case "underline":
            fabricObj = new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 2,
            });
            break;
          case "strikethrough":
          case "strikeout":
            fabricObj = new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 1,
            });
            break;
          case "squiggly":
            // Render as a colored underline for now
            fabricObj = new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 2,
              strokeDashArray: [2, 2],
            });
            break;
          case "note":
          case "stamp":
            fabricObj = new Rect({
              ...annoOptions,
              width: Math.min(annoWidth, 30),
              height: Math.min(annoHeight, 30),
              fill: "#ffeb3b",
              stroke: "#ffc107",
              strokeWidth: 1,
            });
            break;
          case "comment":
          case "freetext":
            fabricObj = new Circle({
              ...annoOptions,
              radius: Math.min(annoWidth, annoHeight) / 2,
              fill: "#2196f3",
              stroke: "#1976d2",
              strokeWidth: 1,
            });
            break;
          case "link":
            fabricObj = new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(0, 100, 200, 0.1)",
              stroke: "#0066cc",
              strokeWidth: 1,
            });
            break;
          default:
            fabricObj = new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(255, 255, 0, 0.3)",
            });
        }
        if (fabricObj) {
          (fabricObj as FabricObjectWithData).data = {
            elementId: annoElement.elementId,
            type: "annotation",
            annotationType: annoElement.annotationType,
            linkDestination: annoElement.linkDestination,
          };
        }
        break;
      }

      case "form_field": {
        const formElement = element;
        // EDITABLE form fields (user directive: "fields should be editable, not
        // rendered as an image"). The page raster (`renderPageNoText`) keeps the
        // PDF's own field frames/borders as the visual ground truth, but the
        // VALUE lives here in an interactive overlay so the user can fill it in:
        //   - text / dropdown → an editable IText bound to the field value
        //     (placeholder shown when empty). Typing persists via the normal
        //     text-edit flow (text:editing:exited → fabricObjectToElement, which
        //     re-reads the value from this object).
        //   - checkbox / radio → an IText carrying a check/dot mark, toggled on
        //     click by `attachFormFieldToggle`; the checked state is stashed on
        //     data.fieldChecked and round-tripped into the field value.
        //   - listbox / signature / button → a hit-target Rect (filled/selected
        //     elsewhere, not via keyboard on the canvas).
        // In every case data.formFieldElement is the canonical full element so
        // the round-trip never loses the field identity (fieldType/options/…).
        const fieldFill = fieldOverlayFill(formElement.fieldType);
        const fieldStroke = fieldOverlayStroke(formElement.fieldType);
        const isTextEntry =
          formElement.fieldType === "text" ||
          formElement.fieldType === "dropdown";
        const isCheckable =
          formElement.fieldType === "checkbox" ||
          formElement.fieldType === "radio";

        if (isTextEntry) {
          const placeholder =
            formElement.placeholder ?? formElement.fieldName ?? "";
          const currentValue = formFieldTextValue(formElement.value);
          const showPlaceholder = currentValue.length === 0;
          // Field font size: honour the AcroForm style, fall back to a size that
          // fits the field height (auto-size fields use 0 in PDF).
          const styleFontSize = formElement.style?.fontSize ?? 0;
          const fieldFontSize =
            styleFontSize > 0
              ? styleFontSize
              : Math.max(8, Math.min(formElement.bounds.height * 0.7, 16));
          const textColour = formElement.style?.textColor || "#0a3a8a";
          const fieldText = new IText(
            showPlaceholder ? placeholder : currentValue,
            {
              ...baseOptions,
              width: formElement.bounds.width,
              // Slight inset + vertical centring inside the field box.
              left: formElement.bounds.x + 2,
              top:
                formElement.bounds.y +
                Math.max(0, (formElement.bounds.height - fieldFontSize) / 2),
              fontSize: fieldFontSize,
              fontFamily: formElement.style?.fontFamily || "Helvetica",
              fill: showPlaceholder ? "rgba(0,0,0,0.4)" : textColour,
              backgroundColor: fieldFill,
              textAlign: formElement.style?.textAlign || "left",
              hasControls: false,
              hasBorders: true,
              borderColor: fieldStroke,
              borderScaleFactor: 1,
              editable: true,
            },
          );
          (fieldText as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            fieldPlaceholder: placeholder,
            fieldShowingPlaceholder: showPlaceholder,
            // Canonical full element → fabricObjectToElement re-merges live
            // bounds + the typed value without losing any business prop.
            formFieldElement: formElement,
          };
          fabricObj = fieldText as unknown as FabricObject;
        } else if (isCheckable) {
          const checked = formFieldChecked(formElement);
          const mark =
            formElement.fieldType === "checkbox"
              ? checked
                ? "☑" // ☑
                : "☐" // ☐
              : checked
                ? "◉" // ◉
                : "○"; // ○
          const markSize = Math.max(
            8,
            Math.min(formElement.bounds.width, formElement.bounds.height) * 0.9,
          );
          const markText = new IText(mark, {
            ...baseOptions,
            left: formElement.bounds.x,
            top: formElement.bounds.y,
            fontSize: markSize,
            fontFamily: "Helvetica",
            fill: checked ? "#0a7a0a" : "#444444",
            backgroundColor: fieldFill,
            // The mark is toggled by click, never edited as text.
            editable: false,
            hasControls: false,
            hasBorders: true,
            borderColor: fieldStroke,
          });
          const exportValue =
            formElement.fieldType === "radio"
              ? formFieldTextValue(
                  formElement.value || formElement.options?.[0] || "",
                )
              : "";
          (markText as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            fieldChecked: checked,
            fieldExportValue: exportValue,
            formFieldElement: formElement,
          };
          fabricObj = markText as unknown as FabricObject;
        } else {
          // listbox / signature / button — selectable hit-target only.
          fabricObj = new Rect({
            ...baseOptions,
            width: formElement.bounds.width,
            height: formElement.bounds.height,
            fill: fieldFill,
            stroke: fieldStroke,
            strokeDashArray: [4, 4],
            strokeWidth: 1,
          });
          (fabricObj as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            // Élément complet : fabricObjectToElement le re-fusionne avec
            // les bounds réels → aucune propriété métier perdue au move.
            formFieldElement: formElement,
          };
        }
        break;
      }
    }

    if (fabricObj) {
      // Mémoriser l'état de verrou sur l'objet Fabric (DRY, point unique) :
      // setElementVisibility en a besoin pour ne PAS ré-activer un élément
      // verrouillé quand on le réaffiche, et le re-render le rétablit ici.
      (fabricObj as FabricObjectWithData).data = {
        ...(fabricObj as FabricObjectWithData).data,
        locked: element.locked === true,
      };
      canvas.add(fabricObj);
    }
  }

  // 4. RENDER PARAGRAPHS as multi-line, editable Textboxes (Word-like). Each
  //    group's runs were excluded from the IText loop above; here they become a
  //    SINGLE Textbox positioned at the block's top-left, sized to the block
  //    width, with the lines joined by "\n". The source runs are stashed on
  //    `data.paragraphRuns` so `fabricObjectToElements` can decompose the block
  //    back into the original runs on save (preserving each run's engine index/
  //    elementId/bounds → lossless `replaceText`). Same typography rules as the
  //    IText branch (embedded font + neutralised synthetic bold/italic).
  for (const group of paragraphGroups) {
    const runs = group.runs;
    const first = runs[0]!;
    // Block geometry from the union of the runs' bounds.
    const blockLeft = Math.min(...runs.map((r) => r.bounds.x));
    const blockTop = Math.min(...runs.map((r) => r.bounds.y));
    const blockRight = Math.max(...runs.map((r) => r.bounds.x + r.bounds.width));
    const blockWidth = Math.max(1, blockRight - blockLeft);

    const fontSize = first.style.fontSize ?? 12;
    const textColour = first.style.color || "#000000";
    const embeddedFontName = (() => {
      const orig = first.style.originalFont;
      if (orig && getFontFaceName) {
        const registered = getFontFaceName(orig);
        if (registered) return registered;
      }
      return null;
    })();
    const usingEmbeddedFont = embeddedFontName !== null;
    const resolvedFontFamily =
      embeddedFontName ?? first.style.fontFamily ?? "Helvetica";
    const content = runs.map((r) => r.content).join("\n");

    const tb = new Textbox(content, {
      left: blockLeft,
      top: blockTop,
      originX: "left" as const,
      originY: "top" as const,
      width: blockWidth,
      angle: first.transform?.rotation || 0,
      selectable: !readonly,
      evented: !readonly,
      visible: first.visible,
      fontSize,
      fontFamily: resolvedFontFamily,
      fontWeight: usingEmbeddedFont
        ? "normal"
        : first.style.fontWeight || "normal",
      fontStyle: usingEmbeddedFont
        ? "normal"
        : first.style.fontStyle || "normal",
      fill: textColour,
      opacity: first.style.opacity ?? 1,
      textAlign: first.style.textAlign || "left",
      lineHeight: first.style.lineHeight || 1.2,
      charSpacing: (first.style.letterSpacing || 0) * 10,
      underline: first.style.underline || false,
      linethrough: first.style.strikethrough || false,
      textBackgroundColor: "",
      cursorColor: textColour,
      cursorWidth: 1,
      selectionColor: "rgba(0, 100, 200, 0.18)",
      hasControls: true,
      hasBorders: true,
      borderColor: "rgba(0, 100, 200, 0.75)",
      borderScaleFactor: 1,
      cornerColor: "rgb(0, 100, 200)",
      cornerStrokeColor: "#ffffff",
      cornerSize: 8,
      transparentCorners: false,
    });

    const paragraphRuns: ParagraphRun[] = runs.map((r) => ({
      elementId: r.elementId,
      ...(r.index !== undefined ? { index: r.index } : {}),
      bounds: {
        x: r.bounds.x,
        y: r.bounds.y,
        width: r.bounds.width,
        height: r.bounds.height,
      },
      content: r.content,
    }));

    (tb as FabricObjectWithData).data = {
      // The paragraph adopts the FIRST run's identity for selection/tracking.
      elementId: first.elementId,
      type: "text",
      // Engine index of the first line — only meaningful when the paragraph is
      // NOT decomposed; the decompose path keeps each run's own index.
      index: first.index,
      rotation0: first.transform?.rotation ?? 0,
      originalFont: first.style.originalFont,
      usingEmbeddedFont,
      originalFill: textColour,
      originalBgColor: first.style.backgroundColor || "",
      // Marks this Textbox as a coalesced paragraph + carries its source runs so
      // the save path decomposes it losslessly (see fabricObjectToElements).
      isParagraph: true,
      paragraphRuns,
      locked: first.locked === true,
    };
    canvas.add(tb as unknown as FabricObject);
  }

  // Wait for all async image loads before final render
  if (imageLoadPromises.length > 0) {
    await Promise.all(imageLoadPromises);
  }

  canvas.renderAll();

  // Repose les masques de visibilité pour les éléments cachés (navigation de
  // page / re-render). Fait APRÈS renderAll() pour que sampleBackgroundUnder
  // lise le raster du fond déjà peint. Les overlays cachés sont aussi rendus
  // non-evented (cohérent avec setElementVisibility : pas d'édition au
  // double-clic sur un élément masqué). Sans applyHideMask injecté (continu),
  // on saute simplement le masquage du fond.
  if (applyHideMask) {
    const hidden = sortedElements.filter((el) => el.visible === false);
    if (hidden.length > 0) {
      for (const el of hidden) {
        const obj = canvas
          .getObjects()
          .find(
            (o) =>
              (o as FabricObjectWithData).data?.elementId === el.elementId &&
              (o as FabricObjectWithData).data?.isHideMask !== true,
          ) as FabricObjectWithData | undefined;
        if (!obj) continue;
        await applyHideMask(canvas, obj);
        (
          obj as FabricObject & { set: (o: Record<string, unknown>) => void }
        ).set({ evented: false, selectable: false });
      }
      canvas.requestRenderAll();
    }
  }

  // Attacher les handlers de sélection si callback fourni et mode non-readonly.
  if (onElementSelected && !readonly) {
    attachSelectionHandlers(canvas, onElementSelected);
  }

  // Reveal a shape's real fill/stroke while it is selected (and re-mask it on
  // deselect). In view the shape is shown by the raster (transparent overlay);
  // on selection we paint the overlay with its `data.original*` so what the user
  // edits is visible. Idempotent per canvas; skipped in read-only surfaces.
  if (!readonly) {
    attachShapeStyleReveal(canvas);
    // Toggle checkbox/radio fields on click (fill them in directly on the page).
    attachFormFieldToggle(canvas, onElementSelected);
  }
}

/**
 * Supprime du canvas tous les objets correspondant à des éléments parsés
 * (identifiés par `data.elementId`). Préserve les objets de fond PDF
 * (`data.isPdfBackground === true`).
 *
 * @returns Nombre d'objets supprimés
 */
export function clearElementsOverlay(canvas: FabricCanvas): number {
  const toRemove = canvas.getObjects().filter((obj) => {
    const data = (obj as FabricObjectWithData).data;
    return data?.elementId !== undefined && !data?.isPdfBackground;
  });

  for (const obj of toRemove) {
    canvas.remove(obj);
  }

  canvas.requestRenderAll();
  return toRemove.length;
}

// ---------------------------------------------------------------------------
// Helpers privés
// ---------------------------------------------------------------------------

/**
 * Attache les listeners `selection:created` et `selection:updated` pour
 * propager l'ID de l'élément sélectionné au callback. Idempotent.
 */
function attachSelectionHandlers(
  canvas: FabricCanvas,
  onElementSelected: (id: string) => void,
): void {
  const canvasWithMeta = canvas as unknown as {
    _renderElementsHandlerAttached?: boolean;
  };

  if (canvasWithMeta._renderElementsHandlerAttached) return;
  canvasWithMeta._renderElementsHandlerAttached = true;

  const handleSelection = (e: { selected?: FabricObject[] }) => {
    const active = e.selected?.[0];
    const data = (active as FabricObjectWithData | undefined)?.data;
    if (data?.elementId) {
      onElementSelected(data.elementId);
    }
  };

  canvas.on("selection:created", handleSelection);
  canvas.on("selection:updated", handleSelection);
}

/**
 * Reveal a shape overlay's real fill/stroke while it is selected, then re-mask
 * it (transparent) on deselection. In view, shapes are shown by the text-free
 * raster background (the overlay is a transparent hit-target, see the `"shape"`
 * case): painting the overlay too would double them and would depend on the
 * unreliable per-index `renderPageExcluding`. Selecting a shape paints the
 * overlay with its stashed `data.original*` so the element the user edits is
 * visible; the move/resize/restyle pipeline bakes the change into the PDF and
 * the page re-renders, after which the raster shows the result. Idempotent per
 * canvas (guarded by a meta flag), so re-renders never stack listeners.
 */
function attachShapeStyleReveal(canvas: FabricCanvas): void {
  const canvasWithMeta = canvas as unknown as {
    _shapeRevealHandlerAttached?: boolean;
    _shapeRevealed?: FabricObjectWithData[];
  };
  if (canvasWithMeta._shapeRevealHandlerAttached) return;
  canvasWithMeta._shapeRevealHandlerAttached = true;
  canvasWithMeta._shapeRevealed = [];

  const restore = (obj: FabricObjectWithData) => {
    obj.set({ fill: "transparent", stroke: "transparent", strokeWidth: 0 });
  };

  const reveal = (obj: FabricObjectWithData) => {
    const data = obj.data;
    if (!data || data.type !== "shape") return;
    const fill =
      typeof data.originalFill === "string" ? data.originalFill : "transparent";
    const stroke =
      typeof data.originalStroke === "string"
        ? data.originalStroke
        : "transparent";
    const strokeWidth =
      typeof data.originalStrokeWidth === "number"
        ? data.originalStrokeWidth
        : 0;
    obj.set({ fill, stroke, strokeWidth });
    if (Array.isArray(data.originalStrokeDashArray)) {
      obj.set({ strokeDashArray: [...data.originalStrokeDashArray] });
    }
  };

  const clearRevealed = () => {
    const revealed = canvasWithMeta._shapeRevealed ?? [];
    for (const obj of revealed) restore(obj);
    canvasWithMeta._shapeRevealed = [];
  };

  const handle = (e: { selected?: FabricObject[] }) => {
    // Re-mask any shapes revealed by a previous selection (selection change).
    clearRevealed();
    const selected = (e.selected ?? []) as FabricObjectWithData[];
    const shapes = selected.filter((o) => o.data?.type === "shape");
    for (const obj of shapes) reveal(obj);
    canvasWithMeta._shapeRevealed = shapes;
    if (shapes.length > 0) canvas.requestRenderAll();
  };

  canvas.on("selection:created", handle);
  canvas.on("selection:updated", handle);
  canvas.on("selection:cleared", () => {
    clearRevealed();
    canvas.requestRenderAll();
  });
}

/**
 * Toggle a checkbox/radio form field when its overlay mark is clicked, so the
 * user fills the form directly on the page. Flips `data.fieldChecked`, swaps the
 * glyph (☑/☐, ◉/○) and its colour, then fires `object:modified` so the change is
 * persisted through the SAME pipeline as every other edit
 * (fabricObjectToElement → operations-store → apply-elements). For a radio, the
 * sibling radios of the same group (same fieldName) are unchecked — a radio
 * group has at most one selected option. Idempotent per canvas.
 */
function attachFormFieldToggle(
  canvas: FabricCanvas,
  onElementSelected?: (id: string) => void,
): void {
  const canvasWithMeta = canvas as unknown as {
    _formFieldToggleAttached?: boolean;
  };
  if (canvasWithMeta._formFieldToggleAttached) return;
  canvasWithMeta._formFieldToggleAttached = true;

  const setMark = (obj: FabricObjectWithData, checked: boolean): void => {
    const fieldType = obj.data?.fieldType;
    const mark =
      fieldType === "checkbox"
        ? checked
          ? "☑"
          : "☐"
        : checked
          ? "◉"
          : "○";
    (
      obj as FabricObject & {
        set: (o: Record<string, unknown>) => void;
        text?: string;
      }
    ).set({ text: mark, fill: checked ? "#0a7a0a" : "#444444" });
  };

  const fireModified = (obj: FabricObject): void => {
    (canvas as unknown as { fire: (e: string, o: unknown) => void }).fire(
      "object:modified",
      { target: obj },
    );
  };

  canvas.on(
    "mouse:down",
    (e: { target?: FabricObject | null }) => {
      const target = e.target as FabricObjectWithData | null;
      if (!target) return;
      const data = target.data;
      if (
        !data ||
        data.type !== "form_field" ||
        (data.fieldType !== "checkbox" && data.fieldType !== "radio")
      ) {
        return;
      }

      const nextChecked = data.fieldChecked !== true;

      if (data.fieldType === "radio" && nextChecked) {
        // Uncheck the other radios of the same group before checking this one.
        const groupName = data.fieldName;
        for (const other of canvas.getObjects() as FabricObjectWithData[]) {
          if (other === target) continue;
          const od = other.data;
          if (
            od?.type === "form_field" &&
            od.fieldType === "radio" &&
            od.fieldName === groupName &&
            od.fieldChecked === true
          ) {
            od.fieldChecked = false;
            setMark(other, false);
            fireModified(other);
          }
        }
      }

      data.fieldChecked = nextChecked;
      setMark(target, nextChecked);
      if (data.elementId && onElementSelected) onElementSelected(data.elementId);
      fireModified(target);
      canvas.requestRenderAll();
    },
  );
}
