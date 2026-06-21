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
import type { Element } from "@giga-pdf/types";
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
  //    (≤2px) is enough — wider tolerance kills legitimate repeats like
  //    "RONY LICHA" appearing twice on a billing page (sender + recipient).
  //    A real shadow/outline duplicate sits within sub-pixel of its twin;
  //    if x or y differs by >2 px the layout intentionally placed two
  //    runs and we must keep both.
  // Two-tier dedupe heuristic:
  //   1. Same content + same colour + within 2px both axes  → shadow/outline
  //      (drop the second occurrence)
  //   2. Same content + same colour + same X (≤3px) + ANY Y → save-loop
  //      duplicate (form re-renders that bake the overlay back into the
  //      PDF and re-parse it). Drop the second occurrence too.
  //   Otherwise (same content, different X) it is a legitimate cross-line
  //   repeat such as "RONY LICHA" appearing on two address lines, both
  //   on the same y but offset horizontally — keep both.
  //
  //   Colour is part of the signature so a white "6,99€" on a red banner
  //   does not get killed by a black drop-shadow twin that appeared first
  //   in the parser stream.
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
    const isDuplicate = positions.some((p) => {
      const dx = Math.abs(p.x - here.x);
      const dy = Math.abs(p.y - here.y);
      const shadowOverlap = dx <= 2 && dy <= 2;
      const verticalStack = dx <= 3; // same column, ANY Y → save-loop dupe
      return shadowOverlap || verticalStack;
    });
    if (isDuplicate) return false;
    positions.push(here);
    return true;
  });

  for (const element of dedupedElements) {
    // Guard: skip elements with missing or zero-size bounds
    if (
      !element.bounds ||
      element.bounds.width <= 0 ||
      element.bounds.height <= 0
    ) {
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
        const textObj = new IText(textElement.content || "", {
          ...baseOptions,
          top: _baselineY + _descenderOffset,
          originY: "bottom" as const,
          width: textElement.bounds.width,
          fontSize: _fontSize,
          fontFamily: (() => {
            const orig = textElement.style.originalFont;
            if (orig && getFontFaceName) {
              const registered = getFontFaceName(orig);
              if (registered) return registered;
            }
            return textElement.style.fontFamily || "Helvetica";
          })(),
          fontWeight: textElement.style.fontWeight || "normal",
          fontStyle: textElement.style.fontStyle || "normal",
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
        (textObj as FabricObjectWithData).data = {
          elementId: textElement.elementId,
          type: "text",
          // Engine text-run index → lossless in-place replaceText/moveElement.
          index: textElement.index,
          rotation0: textElement.transform?.rotation ?? 0,
          originalFont: textElement.style.originalFont,
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
        const fieldColorMap: Record<string, string> = {
          text: "rgba(0, 100, 255, 0.08)",
          checkbox: "rgba(0, 180, 0, 0.1)",
          radio: "rgba(0, 180, 0, 0.1)",
          dropdown: "rgba(100, 0, 255, 0.08)",
          listbox: "rgba(100, 0, 255, 0.08)",
          signature: "rgba(255, 100, 0, 0.1)",
          button: "rgba(50, 50, 50, 0.1)",
        };
        const fieldBorderMap: Record<string, string> = {
          text: "#0066cc",
          checkbox: "#00aa00",
          radio: "#00aa00",
          dropdown: "#6600cc",
          listbox: "#6600cc",
          signature: "#ff6600",
          button: "#333333",
        };
        const fieldFill =
          fieldColorMap[formElement.fieldType] ?? "rgba(0, 100, 255, 0.08)";
        const fieldStroke = fieldBorderMap[formElement.fieldType] ?? "#0066cc";

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
