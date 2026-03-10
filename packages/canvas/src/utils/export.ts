/**
 * Export utilities for converting canvas to various formats
 */

import * as fabric from "fabric";
import type { Bounds } from "@giga-pdf/types";

export interface ExportOptions {
  format?: "png" | "jpeg" | "webp" | "svg";
  quality?: number;
  multiplier?: number;
  bounds?: Bounds;
  backgroundColor?: string;
}

/**
 * Export canvas to data URL
 */
export function exportToDataURL(
  canvas: fabric.Canvas,
  options: ExportOptions = {}
): string {
  const {
    format = "png",
    quality = 1,
    multiplier = 1,
    bounds,
    backgroundColor,
  } = options;

  if (bounds) {
    return canvas.toDataURL({
      format,
      quality,
      multiplier,
      left: bounds.x,
      top: bounds.y,
      width: bounds.width,
      height: bounds.height,
      enableRetinaScaling: true,
    });
  }

  return canvas.toDataURL({
    format,
    quality,
    multiplier,
    enableRetinaScaling: true,
    ...(backgroundColor && { backgroundColor }),
  });
}

/**
 * Export canvas to Blob
 */
export async function exportToBlob(
  canvas: fabric.Canvas,
  options: ExportOptions = {}
): Promise<Blob> {
  const dataURL = exportToDataURL(canvas, options);
  const response = await fetch(dataURL);
  return response.blob();
}

/**
 * Export canvas to SVG
 */
export function exportToSVG(
  canvas: fabric.Canvas,
  options: { bounds?: Bounds } = {}
): string {
  const { bounds } = options;

  if (bounds) {
    const tempCanvas = new fabric.Canvas(null as any);
    const objects = canvas.getObjects().filter((obj) => {
      const objBounds = obj.getBoundingRect();
      return (
        objBounds.left < bounds.x + bounds.width &&
        objBounds.left + objBounds.width > bounds.x &&
        objBounds.top < bounds.y + bounds.height &&
        objBounds.top + objBounds.height > bounds.y
      );
    });

    tempCanvas.add(...objects.map((obj) => fabric.util.object.clone(obj)));
    const svg = tempCanvas.toSVG();
    tempCanvas.dispose();
    return svg;
  }

  return canvas.toSVG();
}

/**
 * Download canvas as file
 */
export async function downloadCanvas(
  canvas: fabric.Canvas,
  filename: string,
  options: ExportOptions = {}
): Promise<void> {
  const { format = "png" } = options;

  let blob: Blob;
  if (format === "svg") {
    const svg = exportToSVG(canvas, options);
    blob = new Blob([svg], { type: "image/svg+xml" });
  } else {
    blob = await exportToBlob(canvas, options);
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Get canvas as ImageData
 */
export function getImageData(
  canvas: fabric.Canvas,
  bounds?: Bounds
): ImageData | null {
  const ctx = canvas.getContext();
  if (!ctx) return null;

  if (bounds) {
    return ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  return ctx.getImageData(0, 0, canvas.width || 0, canvas.height || 0);
}

/**
 * Copy canvas selection to clipboard
 */
export async function copyToClipboard(
  canvas: fabric.Canvas,
  bounds?: Bounds
): Promise<void> {
  const blob = await exportToBlob(canvas, { format: "png", bounds });

  if (navigator.clipboard && ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": blob,
      }),
    ]);
  }
}

/**
 * Create thumbnail from canvas
 */
export function createThumbnail(
  canvas: fabric.Canvas,
  maxWidth: number,
  maxHeight: number
): string {
  const canvasWidth = canvas.width || 0;
  const canvasHeight = canvas.height || 0;

  const scale = Math.min(
    maxWidth / canvasWidth,
    maxHeight / canvasHeight,
    1
  );

  return exportToDataURL(canvas, {
    format: "png",
    multiplier: scale,
    quality: 0.8,
  });
}
