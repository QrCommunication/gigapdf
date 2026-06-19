/**
 * Drawing tool for freehand drawing
 */

import * as fabric from "fabric";
import type { Point } from "@giga-pdf/types";

export interface DrawToolOptions {
  strokeColor?: string;
  strokeWidth?: number;
  smoothing?: boolean;
}

/**
 * Draw tool class for freehand drawing
 */
export class DrawTool {
  private canvas: fabric.Canvas;
  private options: DrawToolOptions;
  private isDrawing: boolean = false;
  private currentPath: fabric.Path | null = null;
  private points: Point[] = [];

  constructor(canvas: fabric.Canvas, options: DrawToolOptions = {}) {
    this.canvas = canvas;
    this.options = {
      strokeColor: "#000000",
      strokeWidth: 2,
      smoothing: true,
      ...options,
    };
  }

  /**
   * Activate draw tool
   */
  activate(): void {
    this.canvas.isDrawingMode = false;
    this.canvas.selection = false;
    this.canvas.defaultCursor = "crosshair";

    this.attachEvents();
  }

  /**
   * Deactivate draw tool
   */
  deactivate(): void {
    this.canvas.isDrawingMode = false;
    this.canvas.selection = true;
    this.canvas.defaultCursor = "default";

    this.detachEvents();
    this.finishDrawing();
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
  private onMouseDown = (e: fabric.TPointerEventInfo<fabric.TPointerEvent>): void => {
    const pointer = this.canvas.getScenePoint(e.e);
    this.isDrawing = true;
    this.points = [{ x: pointer.x, y: pointer.y }];
  };

  /**
   * Handle mouse move
   */
  private onMouseMove = (e: fabric.TPointerEventInfo<fabric.TPointerEvent>): void => {
    if (!this.isDrawing) return;

    const pointer = this.canvas.getScenePoint(e.e);
    this.points.push({ x: pointer.x, y: pointer.y });

    if (this.currentPath) {
      this.canvas.remove(this.currentPath);
    }

    this.currentPath = this.createPath(this.points);
    this.canvas.add(this.currentPath);
    this.canvas.renderAll();
  };

  /**
   * Handle mouse up
   */
  private onMouseUp = (): void => {
    this.finishDrawing();
  };

  /**
   * Create path from points
   */
  private createPath(points: Point[]): fabric.Path {
    const first = points[0];
    if (!first) {
      return new fabric.Path("M 0 0");
    }

    let pathData = `M ${first.x} ${first.y}`;

    if (this.options.smoothing && points.length > 2) {
      // Use quadratic bezier curves for smooth lines
      for (let i = 1; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];
        if (!current || !next) continue;
        const midPoint = {
          x: (current.x + next.x) / 2,
          y: (current.y + next.y) / 2,
        };
        pathData += ` Q ${current.x} ${current.y} ${midPoint.x} ${midPoint.y}`;
      }
      // Add the last point
      const lastPoint = points[points.length - 1];
      if (lastPoint) {
        pathData += ` L ${lastPoint.x} ${lastPoint.y}`;
      }
    } else {
      // Use simple lines
      for (let i = 1; i < points.length; i++) {
        const current = points[i];
        if (!current) continue;
        pathData += ` L ${current.x} ${current.y}`;
      }
    }

    return new fabric.Path(pathData, {
      stroke: this.options.strokeColor,
      strokeWidth: this.options.strokeWidth,
      fill: undefined,
      selectable: true,
    });
  }

  private perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag === 0) return Math.sqrt(Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2));

    const pDistance = Math.abs(dx * (lineStart.y - point.y) - dy * (lineStart.x - point.x)) / mag;
    return pDistance;
  }

  private simplifyPoints(points: Point[], tolerance: number): Point[] {
    if (points.length <= 2) return points;

    const end = points.length - 1;
    const startPoint = points[0];
    const endPoint = points[end];
    if (!startPoint || !endPoint) return points;

    let maxDistance = 0;
    let index = 0;

    for (let i = 1; i < end; i++) {
      const current = points[i];
      if (!current) continue;
      const distance = this.perpendicularDistance(current, startPoint, endPoint);
      if (distance > maxDistance) {
        index = i;
        maxDistance = distance;
      }
    }

    if (maxDistance > tolerance) {
      const left = this.simplifyPoints(points.slice(0, index + 1), tolerance);
      const right = this.simplifyPoints(points.slice(index), tolerance);
      return left.slice(0, left.length - 1).concat(right);
    } else {
      return [startPoint, endPoint];
    }
  }

  /**
   * Finish current drawing
   */
  private finishDrawing(): void {
    if (this.currentPath && this.points.length > 2) {
      this.canvas.remove(this.currentPath);
      // Simplify points with a tolerance of 1.5 pixels
      const simplifiedPoints = this.simplifyPoints(this.points, 1.5);
      this.currentPath = this.createPath(simplifiedPoints);
      this.canvas.add(this.currentPath);
      this.canvas.renderAll();
    }

    this.isDrawing = false;
    this.currentPath = null;
    this.points = [];
  }

  /**
   * Set stroke color
   */
  setStrokeColor(color: string): void {
    this.options.strokeColor = color;
    // Fabric v6: `freeDrawingBrush` is optional until drawing mode initialises it.
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = color;
    }
  }

  /**
   * Set stroke width
   */
  setStrokeWidth(width: number): void {
    this.options.strokeWidth = width;
    // Fabric v6: `freeDrawingBrush` is optional until drawing mode initialises it.
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = width;
    }
  }

  /**
   * Enable/disable smoothing
   */
  setSmoothing(enabled: boolean): void {
    this.options.smoothing = enabled;
  }

  /**
   * Clear all drawings
   */
  clear(): void {
    const objects = this.canvas.getObjects();
    objects.forEach((obj) => {
      if (obj instanceof fabric.Path) {
        this.canvas.remove(obj);
      }
    });
    this.canvas.renderAll();
  }
}
