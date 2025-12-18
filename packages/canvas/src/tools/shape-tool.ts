/**
 * Shape tool for creating shapes
 */

import * as fabric from "fabric";
import type { Point, ShapeType } from "@giga-pdf/types";

export interface ShapeToolOptions {
  shapeType?: ShapeType;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

/**
 * Shape tool class
 */
export class ShapeTool {
  private canvas: fabric.Canvas;
  private options: ShapeToolOptions;
  private isDrawing: boolean = false;
  private startPoint: Point | null = null;
  private currentShape: fabric.Object | null = null;

  constructor(canvas: fabric.Canvas, options: ShapeToolOptions = {}) {
    this.canvas = canvas;
    this.options = {
      shapeType: "rectangle",
      fillColor: "transparent",
      strokeColor: "#000000",
      strokeWidth: 2,
      ...options,
    };
  }

  /**
   * Activate shape tool
   */
  activate(): void {
    this.canvas.selection = false;
    this.canvas.defaultCursor = "crosshair";

    this.attachEvents();
  }

  /**
   * Deactivate shape tool
   */
  deactivate(): void {
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
  private onMouseDown = (e: fabric.IEvent): void => {
    const pointer = this.canvas.getPointer(e.e);
    this.startPoint = { x: pointer.x, y: pointer.y };
    this.isDrawing = true;

    this.currentShape = this.createShape(pointer.x, pointer.y, 0, 0);
    this.canvas.add(this.currentShape);
  };

  /**
   * Handle mouse move
   */
  private onMouseMove = (e: fabric.IEvent): void => {
    if (!this.isDrawing || !this.startPoint || !this.currentShape) return;

    const pointer = this.canvas.getPointer(e.e);
    this.updateShape(this.currentShape, this.startPoint, pointer);
    this.canvas.renderAll();
  };

  /**
   * Handle mouse up
   */
  private onMouseUp = (): void => {
    this.finishDrawing();
  };

  /**
   * Create shape based on type
   */
  private createShape(x: number, y: number, width: number, height: number): fabric.Object {
    const commonOptions = {
      left: x,
      top: y,
      fill: this.options.fillColor,
      stroke: this.options.strokeColor,
      strokeWidth: this.options.strokeWidth,
      selectable: true,
    };

    switch (this.options.shapeType) {
      case "rectangle":
        return new fabric.Rect({
          ...commonOptions,
          width,
          height,
        });

      case "ellipse":
        return new fabric.Ellipse({
          ...commonOptions,
          rx: width / 2,
          ry: height / 2,
        });

      case "line":
        return new fabric.Line([x, y, x + width, y + height], {
          ...commonOptions,
          fill: undefined,
        });

      default:
        return new fabric.Rect({
          ...commonOptions,
          width,
          height,
        });
    }
  }

  /**
   * Update shape dimensions
   */
  private updateShape(shape: fabric.Object, start: Point, end: Point): void {
    const width = end.x - start.x;
    const height = end.y - start.y;

    switch (this.options.shapeType) {
      case "rectangle":
        if (shape instanceof fabric.Rect) {
          shape.set({
            left: width < 0 ? end.x : start.x,
            top: height < 0 ? end.y : start.y,
            width: Math.abs(width),
            height: Math.abs(height),
          });
        }
        break;

      case "ellipse":
        if (shape instanceof fabric.Ellipse) {
          shape.set({
            left: width < 0 ? end.x : start.x,
            top: height < 0 ? end.y : start.y,
            rx: Math.abs(width) / 2,
            ry: Math.abs(height) / 2,
          });
        }
        break;

      case "line":
        if (shape instanceof fabric.Line) {
          shape.set({
            x2: end.x,
            y2: end.y,
          });
        }
        break;
    }

    shape.setCoords();
  }

  /**
   * Finish current drawing
   */
  private finishDrawing(): void {
    if (this.currentShape) {
      this.canvas.setActiveObject(this.currentShape);
    }

    this.isDrawing = false;
    this.startPoint = null;
    this.currentShape = null;
  }

  /**
   * Set shape type
   */
  setShapeType(shapeType: ShapeType): void {
    this.options.shapeType = shapeType;
  }

  /**
   * Set fill color
   */
  setFillColor(color: string): void {
    this.options.fillColor = color;
  }

  /**
   * Set stroke color
   */
  setStrokeColor(color: string): void {
    this.options.strokeColor = color;
  }

  /**
   * Set stroke width
   */
  setStrokeWidth(width: number): void {
    this.options.strokeWidth = width;
  }

  /**
   * Create rectangle
   */
  createRectangle(x: number, y: number, width: number, height: number): fabric.Rect {
    const rect = new fabric.Rect({
      left: x,
      top: y,
      width,
      height,
      fill: this.options.fillColor,
      stroke: this.options.strokeColor,
      strokeWidth: this.options.strokeWidth,
    });

    this.canvas.add(rect);
    this.canvas.setActiveObject(rect);
    return rect;
  }

  /**
   * Create ellipse
   */
  createEllipse(x: number, y: number, rx: number, ry: number): fabric.Ellipse {
    const ellipse = new fabric.Ellipse({
      left: x,
      top: y,
      rx,
      ry,
      fill: this.options.fillColor,
      stroke: this.options.strokeColor,
      strokeWidth: this.options.strokeWidth,
    });

    this.canvas.add(ellipse);
    this.canvas.setActiveObject(ellipse);
    return ellipse;
  }

  /**
   * Create circle
   */
  createCircle(x: number, y: number, radius: number): fabric.Circle {
    const circle = new fabric.Circle({
      left: x,
      top: y,
      radius,
      fill: this.options.fillColor,
      stroke: this.options.strokeColor,
      strokeWidth: this.options.strokeWidth,
    });

    this.canvas.add(circle);
    this.canvas.setActiveObject(circle);
    return circle;
  }

  /**
   * Create line
   */
  createLine(x1: number, y1: number, x2: number, y2: number): fabric.Line {
    const line = new fabric.Line([x1, y1, x2, y2], {
      stroke: this.options.strokeColor,
      strokeWidth: this.options.strokeWidth,
    });

    this.canvas.add(line);
    this.canvas.setActiveObject(line);
    return line;
  }
}
