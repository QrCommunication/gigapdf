/**
 * Custom selection box for multi-selection
 */

import * as fabric from "fabric";
import type { Bounds } from "@giga-pdf/types";

export interface SelectionBoxOptions extends fabric.IRectOptions {
  selectionColor?: string;
  selectionBorderColor?: string;
}

/**
 * Selection box for multi-select operations
 */
export class SelectionBox extends fabric.Rect {
  selectionColor: string;
  selectionBorderColor: string;

  constructor(options: SelectionBoxOptions = {}) {
    super({
      fill: "transparent",
      stroke: options.selectionBorderColor || "#0099FF",
      strokeWidth: 1,
      strokeDashArray: [5, 5],
      selectable: false,
      evented: false,
      ...options,
    });

    this.selectionColor = options.selectionColor || "rgba(0, 153, 255, 0.1)";
    this.selectionBorderColor = options.selectionBorderColor || "#0099FF";
  }

  /**
   * Update selection box bounds
   */
  updateBounds(bounds: Bounds): void {
    this.set({
      left: bounds.x,
      top: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }

  /**
   * Show selection box
   */
  show(): void {
    this.set({
      visible: true,
      fill: this.selectionColor,
    });
  }

  /**
   * Hide selection box
   */
  hide(): void {
    this.set({
      visible: false,
    });
  }

  /**
   * Get selection bounds
   */
  getBounds(): Bounds {
    return {
      x: this.left || 0,
      y: this.top || 0,
      width: this.width || 0,
      height: this.height || 0,
    };
  }

  /**
   * Check if point is inside selection
   */
  containsPoint(x: number, y: number): boolean {
    const bounds = this.getBounds();
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  /**
   * Check if object intersects with selection
   */
  intersectsObject(obj: fabric.Object): boolean {
    const selectionBounds = this.getBounds();
    const objBounds = obj.getBoundingRect();

    return !(
      objBounds.left + objBounds.width < selectionBounds.x ||
      selectionBounds.x + selectionBounds.width < objBounds.left ||
      objBounds.top + objBounds.height < selectionBounds.y ||
      selectionBounds.y + selectionBounds.height < objBounds.top
    );
  }

  /**
   * Get all objects within selection bounds
   */
  getIntersectingObjects(canvas: fabric.Canvas): fabric.Object[] {
    const objects = canvas.getObjects();
    return objects.filter((obj) => {
      if (obj === this) return false;
      return this.intersectsObject(obj);
    });
  }
}

// Register the class with Fabric.js
