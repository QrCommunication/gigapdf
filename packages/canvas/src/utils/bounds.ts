/**
 * Bounds calculation and manipulation utilities
 */

import type { Bounds, Point } from "@giga-pdf/types";
import * as fabric from "fabric";

/**
 * Get the bounds of a Fabric.js object
 */
export function getObjectBounds(obj: fabric.Object): Bounds {
  const rect = obj.getBoundingRect(true);
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Get the bounds of multiple Fabric.js objects
 */
export function getGroupBounds(objects: fabric.Object[]): Bounds | null {
  if (objects.length === 0) return null;

  const bounds = objects.map((obj) => getObjectBounds(obj));
  return unionBounds(bounds);
}

/**
 * Union multiple bounds into a single encompassing bounds
 */
export function unionBounds(bounds: Bounds[]): Bounds | null {
  if (bounds.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const b of bounds) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Expand bounds by a margin
 */
export function expandBounds(bounds: Bounds, margin: number): Bounds {
  return {
    x: bounds.x - margin,
    y: bounds.y - margin,
    width: bounds.width + margin * 2,
    height: bounds.height + margin * 2,
  };
}

/**
 * Constrain bounds within container bounds
 */
export function constrainBounds(bounds: Bounds, container: Bounds): Bounds {
  const x = Math.max(container.x, Math.min(bounds.x, container.x + container.width - bounds.width));
  const y = Math.max(container.y, Math.min(bounds.y, container.y + container.height - bounds.height));

  return {
    x,
    y,
    width: Math.min(bounds.width, container.width),
    height: Math.min(bounds.height, container.height),
  };
}

/**
 * Get center point of bounds
 */
export function getBoundsCenter(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * Check if bounds are valid (positive dimensions)
 */
export function isValidBounds(bounds: Bounds): boolean {
  return bounds.width > 0 && bounds.height > 0;
}

/**
 * Check if point is inside bounds
 */
export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/**
 * Check if two bounds intersect
 */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/**
 * Get intersection of two bounds
 */
export function getBoundsIntersection(a: Bounds, b: Bounds): Bounds | null {
  if (!boundsIntersect(a, b)) return null;

  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;

  return { x, y, width, height };
}

/**
 * Scale bounds by a factor
 */
export function scaleBounds(bounds: Bounds, scale: number): Bounds {
  return {
    x: bounds.x * scale,
    y: bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  };
}

/**
 * Normalize bounds to ensure positive dimensions
 */
export function normalizeBounds(bounds: Bounds): Bounds {
  return {
    x: bounds.width < 0 ? bounds.x + bounds.width : bounds.x,
    y: bounds.height < 0 ? bounds.y + bounds.height : bounds.y,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}
