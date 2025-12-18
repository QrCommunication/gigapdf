/**
 * Zoom tool for zooming the canvas
 */

import * as fabric from "fabric";
import type { Point } from "@giga-pdf/types";

export interface ZoomToolOptions {
  minZoom?: number;
  maxZoom?: number;
  step?: number;
  cursor?: string;
}

/**
 * Zoom tool class
 */
export class ZoomTool {
  private canvas: fabric.Canvas;
  private options: ZoomToolOptions;
  private currentZoom: number = 1;

  constructor(canvas: fabric.Canvas, options: ZoomToolOptions = {}) {
    this.canvas = canvas;
    this.options = {
      minZoom: 0.1,
      maxZoom: 10,
      step: 0.1,
      cursor: "zoom-in",
      ...options,
    };
  }

  /**
   * Activate zoom tool
   */
  activate(): void {
    this.canvas.selection = false;
    this.canvas.defaultCursor = this.options.cursor || "zoom-in";

    // Disable object selection
    this.canvas.forEachObject((obj) => {
      obj.set("selectable", false);
    });

    this.attachEvents();
  }

  /**
   * Deactivate zoom tool
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
    this.canvas.on("mouse:wheel", this.onMouseWheel);
  }

  /**
   * Detach event handlers
   */
  private detachEvents(): void {
    this.canvas.off("mouse:wheel", this.onMouseWheel);
  }

  /**
   * Handle mouse wheel
   */
  private onMouseWheel = (opt: fabric.IEvent): void => {
    const e = opt.e as WheelEvent;
    const delta = e.deltaY;
    let zoom = this.canvas.getZoom();

    zoom *= 0.999 ** delta;
    zoom = this.constrainZoom(zoom);

    const pointer = this.canvas.getPointer(opt.e);
    this.zoomToPoint({ x: pointer.x, y: pointer.y }, zoom);

    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Constrain zoom within min/max bounds
   */
  private constrainZoom(zoom: number): number {
    const { minZoom = 0.1, maxZoom = 10 } = this.options;
    return Math.max(minZoom, Math.min(maxZoom, zoom));
  }

  /**
   * Zoom to a specific level
   */
  zoom(level: number): void {
    const zoom = this.constrainZoom(level);
    this.canvas.setZoom(zoom);
    this.currentZoom = zoom;
    this.canvas.requestRenderAll();
  }

  /**
   * Zoom to a point
   */
  zoomToPoint(point: Point, zoom: number): void {
    const constrainedZoom = this.constrainZoom(zoom);
    this.canvas.zoomToPoint(new fabric.Point(point.x, point.y), constrainedZoom);
    this.currentZoom = constrainedZoom;
  }

  /**
   * Zoom in
   */
  zoomIn(): void {
    const newZoom = this.currentZoom + (this.options.step || 0.1);
    this.zoom(newZoom);
  }

  /**
   * Zoom out
   */
  zoomOut(): void {
    const newZoom = this.currentZoom - (this.options.step || 0.1);
    this.zoom(newZoom);
  }

  /**
   * Reset zoom to 100%
   */
  reset(): void {
    this.zoom(1);
  }

  /**
   * Zoom to fit canvas
   */
  zoomToFit(): void {
    const objects = this.canvas.getObjects();
    if (objects.length === 0) return;

    const group = new fabric.Group(objects);
    const groupWidth = group.width || 0;
    const groupHeight = group.height || 0;

    const canvasWidth = this.canvas.width || 0;
    const canvasHeight = this.canvas.height || 0;

    const zoom = Math.min(
      canvasWidth / groupWidth,
      canvasHeight / groupHeight
    );

    this.zoom(zoom * 0.9); // 90% to add some padding

    // Center the content
    const center = group.getCenterPoint();
    this.canvas.viewportTransform![4] = canvasWidth / 2 - center.x * zoom;
    this.canvas.viewportTransform![5] = canvasHeight / 2 - center.y * zoom;

    group.destroy();
    this.canvas.requestRenderAll();
  }

  /**
   * Zoom to selection
   */
  zoomToSelection(): void {
    const activeObject = this.canvas.getActiveObject();
    if (!activeObject) return;

    const bounds = activeObject.getBoundingRect();
    const canvasWidth = this.canvas.width || 0;
    const canvasHeight = this.canvas.height || 0;

    const zoom = Math.min(
      canvasWidth / bounds.width,
      canvasHeight / bounds.height
    );

    const center = activeObject.getCenterPoint();
    this.zoomToPoint(center, zoom * 0.9);

    // Center the object
    this.canvas.viewportTransform![4] = canvasWidth / 2 - center.x * zoom;
    this.canvas.viewportTransform![5] = canvasHeight / 2 - center.y * zoom;

    this.canvas.requestRenderAll();
  }

  /**
   * Get current zoom level
   */
  getZoom(): number {
    return this.currentZoom;
  }

  /**
   * Set zoom limits
   */
  setLimits(minZoom: number, maxZoom: number): void {
    this.options.minZoom = minZoom;
    this.options.maxZoom = maxZoom;

    // Reapply current zoom to ensure it's within new limits
    this.zoom(this.currentZoom);
  }

  /**
   * Enable mouse wheel zoom
   */
  enableMouseWheelZoom(): void {
    this.attachEvents();
  }

  /**
   * Disable mouse wheel zoom
   */
  disableMouseWheelZoom(): void {
    this.detachEvents();
  }
}
