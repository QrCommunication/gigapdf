/**
 * Shape element renderer
 */

import * as fabric from "fabric";
import type { ShapeElement } from "@giga-pdf/types";
import { PDFShape } from "../objects/pdf-shape";

/**
 * Render shape elements to canvas
 */
export class ShapeRenderer {
  /**
   * Render a single shape element
   */
  static async renderElement(
    canvas: fabric.Canvas,
    element: ShapeElement
  ): Promise<fabric.Object> {
    const shapeObject = PDFShape.fromElement(element);
    canvas.add(shapeObject);
    return shapeObject;
  }

  /**
   * Render multiple shape elements
   */
  static async renderElements(
    canvas: fabric.Canvas,
    elements: ShapeElement[]
  ): Promise<fabric.Object[]> {
    const objects: fabric.Object[] = [];

    for (const element of elements) {
      const obj = await this.renderElement(canvas, element);
      objects.push(obj);
    }

    return objects;
  }

  /**
   * Create rectangle
   */
  static createRectangle(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    width: number,
    height: number,
    options: Partial<fabric.IRectOptions> = {}
  ): fabric.Rect {
    const rect = new fabric.Rect({
      left: x,
      top: y,
      width,
      height,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
      ...options,
    });

    canvas.add(rect);
    canvas.setActiveObject(rect);
    return rect;
  }

  /**
   * Create ellipse
   */
  static createEllipse(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    rx: number,
    ry: number,
    options: Partial<fabric.IEllipseOptions> = {}
  ): fabric.Ellipse {
    const ellipse = new fabric.Ellipse({
      left: x,
      top: y,
      rx,
      ry,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
      ...options,
    });

    canvas.add(ellipse);
    canvas.setActiveObject(ellipse);
    return ellipse;
  }

  /**
   * Create line
   */
  static createLine(
    canvas: fabric.Canvas,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: Partial<fabric.ILineOptions> = {}
  ): fabric.Line {
    const line = new fabric.Line([x1, y1, x2, y2], {
      stroke: "#000000",
      strokeWidth: 2,
      ...options,
    });

    canvas.add(line);
    canvas.setActiveObject(line);
    return line;
  }

  /**
   * Create polygon
   */
  static createPolygon(
    canvas: fabric.Canvas,
    points: { x: number; y: number }[],
    options: Partial<fabric.IPolylineOptions> = {}
  ): fabric.Polygon {
    const polygon = new fabric.Polygon(points, {
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
      ...options,
    });

    canvas.add(polygon);
    canvas.setActiveObject(polygon);
    return polygon;
  }

  /**
   * Create path
   */
  static createPath(
    canvas: fabric.Canvas,
    pathData: string,
    options: Partial<fabric.IPathOptions> = {}
  ): fabric.Path {
    const path = new fabric.Path(pathData, {
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
      ...options,
    });

    canvas.add(path);
    canvas.setActiveObject(path);
    return path;
  }

  /**
   * Create circle
   */
  static createCircle(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    radius: number,
    options: Partial<fabric.ICircleOptions> = {}
  ): fabric.Circle {
    const circle = new fabric.Circle({
      left: x,
      top: y,
      radius,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
      ...options,
    });

    canvas.add(circle);
    canvas.setActiveObject(circle);
    return circle;
  }

  /**
   * Create rounded rectangle
   */
  static createRoundedRectangle(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    options: Partial<fabric.IRectOptions> = {}
  ): fabric.Rect {
    const rect = new fabric.Rect({
      left: x,
      top: y,
      width,
      height,
      rx: radius,
      ry: radius,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: 2,
      ...options,
    });

    canvas.add(rect);
    canvas.setActiveObject(rect);
    return rect;
  }

  /**
   * Apply shape style
   */
  static applyStyle(
    obj: fabric.Object,
    style: {
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      strokeDashArray?: number[];
      opacity?: number;
    }
  ): void {
    obj.set({
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeDashArray: style.strokeDashArray,
      opacity: style.opacity,
    });

    obj.canvas?.renderAll();
  }

  /**
   * Update shape points
   */
  static updatePoints(
    obj: fabric.Object,
    points: { x: number; y: number }[]
  ): void {
    if (obj instanceof fabric.Polygon || obj instanceof fabric.Polyline) {
      obj.set("points", points);
      obj.canvas?.renderAll();
    }
  }

  /**
   * Convert shape to path
   */
  static convertToPath(obj: fabric.Object): fabric.Path | null {
    if (obj instanceof fabric.Path) {
      return obj;
    }

    // Get SVG representation and convert to path
    const svg = obj.toSVG();
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, "image/svg+xml");
    const pathElement = doc.querySelector("path");

    if (pathElement) {
      const pathData = pathElement.getAttribute("d");
      if (pathData) {
        return new fabric.Path(pathData, {
          fill: obj.fill,
          stroke: obj.stroke,
          strokeWidth: obj.strokeWidth,
          opacity: obj.opacity,
        });
      }
    }

    return null;
  }
}
