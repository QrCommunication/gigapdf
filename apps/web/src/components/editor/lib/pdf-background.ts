/**
 * pdf-background.ts
 *
 * Shared construction of the PDF-background image that sits at index 0 of an
 * editor `fabric.Canvas`. Both the single-page {@link EditorCanvas} (`loadPage`)
 * and the continuous-view `PageCanvasHost` build this identical object, so the
 * Fabric-image setup lives here once rather than being duplicated.
 *
 * The page is rasterised at a HiDPI `renderScale` for crispness, then scaled
 * back down via `scaleX/scaleY = 1/renderScale` so the Fabric object keeps the
 * page's true PDF-point dimensions. It is non-selectable / non-evented: the
 * editable overlay rendered above it acts as the click hit-target.
 */

import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import type * as FabricNamespace from "fabric";

type FabricModule = typeof FabricNamespace;

/** Marker stored in `obj.data` to identify (and preserve) the PDF background. */
export interface PdfBackgroundData {
  isPdfBackground: true;
}

/**
 * HiDPI render scale for the background bitmap. Capped at 3 to bound memory; the
 * `fabric.Canvas` is downscaled by the same factor so geometry stays in points.
 */
export function backgroundRenderScale(devicePixelRatio: number | undefined): number {
  return Math.min(devicePixelRatio || 2, 3);
}

/**
 * Build the background `FabricImage` from an already-rendered PNG data URL and
 * add it to `canvas` at index 0.
 *
 * The caller is responsible for producing `dataUrl` at `renderScale` (e.g. via
 * `PDFRenderer.renderPageToDataURL` or {@link PageRenderPool.renderBackground}),
 * and for ensuring the canvas is otherwise empty so the image lands at index 0.
 *
 * @returns the created `FabricImage`, or `null` if image construction failed.
 */
export async function addPdfBackground(
  canvas: FabricCanvas,
  fabric: FabricModule,
  dataUrl: string,
  renderScale: number,
): Promise<FabricObject | null> {
  const bgImg = await fabric.FabricImage.fromURL(dataUrl);
  bgImg.set({
    left: 0,
    top: 0,
    // Fabric defaults originX/Y to 'center'. Without forcing 'left'/'top' the
    // image is centred on (0, 0) and only its bottom-right quadrant lands inside
    // the canvas — the "PDF appears as fragments" bug.
    originX: "left",
    originY: "top",
    scaleX: 1 / renderScale,
    scaleY: 1 / renderScale,
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
  });
  (bgImg as FabricObject & { data?: PdfBackgroundData }).data = {
    isPdfBackground: true,
  };
  canvas.add(bgImg); // canvas is empty here → bgImg is at index 0
  return bgImg as unknown as FabricObject;
}
