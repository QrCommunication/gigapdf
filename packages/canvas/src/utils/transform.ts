/**
 * Transform utilities for converting between coordinate systems and handling transformations
 */

import type { Transform, Point, Bounds } from "@giga-pdf/types";
import * as fabric from "fabric";

/**
 * Convert PDF coordinates (origin bottom-left) to canvas coordinates (origin top-left)
 */
export function pdfToCanvas(point: Point, pageHeight: number): Point {
  return {
    x: point.x,
    y: pageHeight - point.y,
  };
}

/**
 * Convert canvas coordinates (origin top-left) to PDF coordinates (origin bottom-left)
 */
export function canvasToPdf(point: Point, pageHeight: number): Point {
  return {
    x: point.x,
    y: pageHeight - point.y,
  };
}

/**
 * Convert Transform to Fabric.js object transformation
 */
export function transformToFabric(transform: Transform) {
  return {
    angle: transform.rotation,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    skewX: transform.skewX,
    skewY: transform.skewY,
  };
}

/**
 * Convert Fabric.js object transformation to Transform
 */
export function fabricToTransform(obj: fabric.Object): Transform {
  return {
    rotation: obj.angle || 0,
    scaleX: obj.scaleX || 1,
    scaleY: obj.scaleY || 1,
    skewX: obj.skewX || 0,
    skewY: obj.skewY || 0,
  };
}

/**
 * Convert Bounds to Fabric.js object position
 */
export function boundsToFabric(bounds: Bounds) {
  return {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * Convert Fabric.js object position to Bounds
 */
export function fabricToBounds(obj: fabric.Object): Bounds {
  const bounds = obj.getBoundingRect();
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * Apply zoom transformation to a point
 */
export function applyZoom(point: Point, zoom: number, center: Point): Point {
  return {
    x: (point.x - center.x) * zoom + center.x,
    y: (point.y - center.y) * zoom + center.y,
  };
}

/**
 * Remove zoom transformation from a point
 */
export function removeZoom(point: Point, zoom: number, center: Point): Point {
  return {
    x: (point.x - center.x) / zoom + center.x,
    y: (point.y - center.y) / zoom + center.y,
  };
}

/**
 * Rotate a point around a center point
 */
export function rotatePoint(
  point: Point,
  center: Point,
  angleDegrees: number
): Point {
  const angleRad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}
