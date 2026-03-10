/**
 * Pan tool for moving the canvas viewport
 */

import * as fabric from "fabric";
import type { Point } from "@giga-pdf/types";

export interface PanToolOptions {
  cursor?: string;
}

/**
 * Pan tool class
 */
export class PanTool {
  private canvas: fabric.Canvas;
  private options: PanToolOptions;
  private isPanning: boolean = false;
  private lastPoint: Point | null = null;

  constructor(canvas: fabric.Canvas, options: PanToolOptions = {}) {
    this.canvas = canvas;
    this.options = {
      cursor: "grab",
      ...options,
    };
  }

  /**
   * Activate pan tool
   */
  activate(): void {
    this.canvas.selection = false;
    this.canvas.defaultCursor = this.options.cursor || "grab";

    // Disable object selection
    this.canvas.forEachObject((obj) => {
      obj.set("selectable", false);
    });

    this.attachEvents();
  }

  /**
   * Deactivate pan tool
   */
  deactivate(): void {
    this.canvas.selection = true;
    this.canvas.defaultCursor = "default";

    // Re-enable object selection
    this.canvas.forEachObject((obj) => {
      obj.set("selectable", true);
    });

    this.detachEvents();
  }

  /**
   * Attach event handlers
   */
  private attachEvents(): void {
    this.canvas.on("mouse:down", this.onMouseDown);
    this.canvas.on("mouse:move", this.onMouseMove);
    this.canvas.on("mouse:up", this.onMouseUp);
  }

  /**
   * Detach event handlers
   */
  private detachEvents(): void {
    this.canvas.off("mouse:down", this.onMouseDown);
    this.canvas.off("mouse:move", this.onMouseMove);
    this.canvas.off("mouse:up", this.onMouseUp);
  }

  /**
   * Handle mouse down
   */
  private onMouseDown = (e: fabric.IEvent): void => {
    this.isPanning = true;
    this.canvas.defaultCursor = "grabbing";

    const pointer = this.canvas.getPointer(e.e);
    this.lastPoint = { x: pointer.x, y: pointer.y };
  };

  /**
   * Handle mouse move
   */
  private onMouseMove = (e: fabric.IEvent): void => {
    if (!this.isPanning || !this.lastPoint) return;

    const pointer = this.canvas.getPointer(e.e);
    const deltaX = pointer.x - this.lastPoint.x;
    const deltaY = pointer.y - this.lastPoint.y;

    this.pan(deltaX, deltaY);

    this.lastPoint = { x: pointer.x, y: pointer.y };
  };

  /**
   * Handle mouse up
   */
  private onMouseUp = (): void => {
    this.isPanning = false;
    this.lastPoint = null;
    this.canvas.defaultCursor = this.options.cursor || "grab";
  };

  /**
   * Pan the canvas
   */
  pan(deltaX: number, deltaY: number): void {
    const vpt = this.canvas.viewportTransform;
    if (!vpt) return;

    vpt[4] += deltaX;
    vpt[5] += deltaY;

    this.canvas.requestRenderAll();
  }

  /**
   * Reset pan to origin
   */
  reset(): void {
    const vpt = this.canvas.viewportTransform;
    if (!vpt) return;

    vpt[4] = 0;
    vpt[5] = 0;

    this.canvas.requestRenderAll();
  }

  /**
   * Get current pan offset
   */
  getOffset(): Point {
    const vpt = this.canvas.viewportTransform;
    if (!vpt) return { x: 0, y: 0 };

    return {
      x: vpt[4],
      y: vpt[5],
    };
  }

  /**
   * Set pan offset
   */
  setOffset(offset: Point): void {
    const vpt = this.canvas.viewportTransform;
    if (!vpt) return;

    vpt[4] = offset.x;
    vpt[5] = offset.y;

    this.canvas.requestRenderAll();
  }

  /**
   * Pan to center a point
   */
  panToPoint(point: Point): void {
    const canvasWidth = this.canvas.width || 0;
    const canvasHeight = this.canvas.height || 0;

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    const vpt = this.canvas.viewportTransform;
    if (!vpt) return;

    vpt[4] = centerX - point.x * vpt[0];
    vpt[5] = centerY - point.y * vpt[3];

    this.canvas.requestRenderAll();
  }
}
