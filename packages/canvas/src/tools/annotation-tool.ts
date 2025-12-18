/**
 * Annotation tool for creating annotations
 */

import * as fabric from "fabric";
import type { AnnotationType, Point } from "@giga-pdf/types";

export interface AnnotationToolOptions {
  annotationType?: AnnotationType;
  color?: string;
  opacity?: number;
}

/**
 * Annotation tool class
 */
export class AnnotationTool {
  private canvas: fabric.Canvas;
  private options: AnnotationToolOptions;
  private isDrawing: boolean = false;
  private startPoint: Point | null = null;
  private currentAnnotation: fabric.Object | null = null;

  constructor(canvas: fabric.Canvas, options: AnnotationToolOptions = {}) {
    this.canvas = canvas;
    this.options = {
      annotationType: "highlight",
      color: "#FFFF00",
      opacity: 0.3,
      ...options,
    };
  }

  /**
   * Activate annotation tool
   */
  activate(): void {
    this.canvas.selection = false;
    this.canvas.defaultCursor = "crosshair";

    this.attachEvents();
  }

  /**
   * Deactivate annotation tool
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

    this.currentAnnotation = this.createAnnotation(pointer.x, pointer.y, 0, 0);
    if (this.currentAnnotation) {
      this.canvas.add(this.currentAnnotation);
    }
  };

  /**
   * Handle mouse move
   */
  private onMouseMove = (e: fabric.IEvent): void => {
    if (!this.isDrawing || !this.startPoint || !this.currentAnnotation) return;

    const pointer = this.canvas.getPointer(e.e);
    this.updateAnnotation(this.currentAnnotation, this.startPoint, pointer);
    this.canvas.renderAll();
  };

  /**
   * Handle mouse up
   */
  private onMouseUp = (): void => {
    this.finishDrawing();
  };

  /**
   * Create annotation based on type
   */
  private createAnnotation(x: number, y: number, width: number, height: number): fabric.Object | null {
    switch (this.options.annotationType) {
      case "highlight":
        return new fabric.Rect({
          left: x,
          top: y,
          width,
          height,
          fill: this.options.color,
          opacity: this.options.opacity,
          selectable: true,
        });

      case "underline":
        return new fabric.Line([x, y, x + width, y], {
          stroke: this.options.color,
          strokeWidth: 2,
          opacity: this.options.opacity,
          selectable: true,
        });

      case "strikeout":
        return new fabric.Line([x, y, x + width, y], {
          stroke: this.options.color,
          strokeWidth: 2,
          opacity: this.options.opacity,
          selectable: true,
        });

      case "note":
        return this.createNote(x, y);

      case "freetext":
        return this.createFreetext(x, y, width, height);

      case "stamp":
        return this.createStamp(x, y);

      default:
        return null;
    }
  }

  /**
   * Update annotation dimensions
   */
  private updateAnnotation(annotation: fabric.Object, start: Point, end: Point): void {
    const width = end.x - start.x;
    const height = end.y - start.y;

    if (annotation instanceof fabric.Rect) {
      annotation.set({
        left: width < 0 ? end.x : start.x,
        top: height < 0 ? end.y : start.y,
        width: Math.abs(width),
        height: Math.abs(height),
      });
    } else if (annotation instanceof fabric.Line) {
      annotation.set({
        x2: end.x,
        y2: end.y,
      });
    } else if (annotation instanceof fabric.Group) {
      annotation.set({
        left: width < 0 ? end.x : start.x,
        top: height < 0 ? end.y : start.y,
        scaleX: Math.abs(width) / 100,
        scaleY: Math.abs(height) / 100,
      });
    }

    annotation.setCoords();
  }

  /**
   * Create note annotation
   */
  private createNote(x: number, y: number): fabric.Group {
    const circle = new fabric.Circle({
      radius: 12,
      fill: this.options.color,
      left: 0,
      top: 0,
    });

    const text = new fabric.Text("📝", {
      fontSize: 16,
      left: -8,
      top: -8,
    });

    return new fabric.Group([circle, text], {
      left: x,
      top: y,
      selectable: true,
    });
  }

  /**
   * Create freetext annotation
   */
  private createFreetext(x: number, y: number, width: number, height: number): fabric.Group {
    const background = new fabric.Rect({
      width: 100,
      height: 50,
      fill: "#FFFFFF",
      stroke: this.options.color,
      strokeWidth: 1,
      left: 0,
      top: 0,
    });

    const textbox = new fabric.Textbox("", {
      width: 90,
      fontSize: 12,
      fill: "#000000",
      left: 5,
      top: 5,
    });

    return new fabric.Group([background, textbox], {
      left: x,
      top: y,
      selectable: true,
    });
  }

  /**
   * Create stamp annotation
   */
  private createStamp(x: number, y: number): fabric.Group {
    const rect = new fabric.Rect({
      width: 100,
      height: 40,
      fill: "transparent",
      stroke: this.options.color,
      strokeWidth: 2,
      left: 0,
      top: 0,
    });

    const text = new fabric.Text("APPROVED", {
      fontSize: 14,
      fontWeight: "bold",
      fill: this.options.color,
      left: 10,
      top: 10,
    });

    return new fabric.Group([rect, text], {
      left: x,
      top: y,
      selectable: true,
    });
  }

  /**
   * Finish current drawing
   */
  private finishDrawing(): void {
    if (this.currentAnnotation) {
      this.canvas.setActiveObject(this.currentAnnotation);
    }

    this.isDrawing = false;
    this.startPoint = null;
    this.currentAnnotation = null;
  }

  /**
   * Set annotation type
   */
  setAnnotationType(type: AnnotationType): void {
    this.options.annotationType = type;
  }

  /**
   * Set annotation color
   */
  setColor(color: string): void {
    this.options.color = color;
  }

  /**
   * Set annotation opacity
   */
  setOpacity(opacity: number): void {
    this.options.opacity = opacity;
  }
}
