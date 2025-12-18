/**
 * Custom Fabric.js shape objects for PDF shape elements
 */

import * as fabric from "fabric";
import type { ShapeElement, UUID, Point } from "@giga-pdf/types";
import { boundsToFabric, transformToFabric } from "../utils/transform";

export interface PDFShapeOptions extends fabric.IObjectOptions {
  elementId?: UUID;
  element?: ShapeElement;
}

/**
 * Base class for PDF shape objects
 */
export class PDFShape extends fabric.Object {
  elementId?: UUID;
  element?: ShapeElement;

  constructor(options: PDFShapeOptions = {}) {
    super(options);
    this.elementId = options.elementId;
    this.element = options.element;
  }

  /**
   * Create appropriate shape object from ShapeElement
   */
  static fromElement(element: ShapeElement): fabric.Object {
    const fabricProps = boundsToFabric(element.bounds);
    const fabricTransform = transformToFabric(element.transform);

    const commonOptions = {
      elementId: element.elementId,
      element,
      ...fabricProps,
      ...fabricTransform,
      fill: element.style.fillColor || undefined,
      opacity: element.style.fillOpacity,
      stroke: element.style.strokeColor || undefined,
      strokeWidth: element.style.strokeWidth,
      strokeDashArray: element.style.strokeDashArray.length > 0 ? element.style.strokeDashArray : undefined,
      selectable: !element.locked,
      visible: element.visible,
      lockMovementX: element.locked,
      lockMovementY: element.locked,
      lockRotation: element.locked,
      lockScalingX: element.locked,
      lockScalingY: element.locked,
    };

    switch (element.shapeType) {
      case "rectangle":
        return new fabric.Rect({
          ...commonOptions,
          rx: element.geometry.cornerRadius,
          ry: element.geometry.cornerRadius,
        });

      case "ellipse":
        return new fabric.Ellipse({
          ...commonOptions,
          rx: fabricProps.width / 2,
          ry: fabricProps.height / 2,
        });

      case "line":
        if (element.geometry.points.length >= 2) {
          const [start, end] = element.geometry.points;
          return new fabric.Line([start.x, start.y, end.x, end.y], {
            ...commonOptions,
            fill: undefined,
          });
        }
        break;

      case "polygon":
        if (element.geometry.points.length >= 3) {
          return new fabric.Polygon(
            element.geometry.points.map((p) => ({ x: p.x, y: p.y })),
            commonOptions
          );
        }
        break;

      case "path":
        if (element.geometry.pathData) {
          return new fabric.Path(element.geometry.pathData, commonOptions);
        }
        break;
    }

    // Fallback to rectangle
    return new fabric.Rect(commonOptions);
  }

  /**
   * Convert Fabric shape to ShapeElement
   */
  static toElement(obj: fabric.Object, shapeType: ShapeElement["shapeType"]): Partial<ShapeElement> {
    const bounds = obj.getBoundingRect();
    const points: Point[] = [];
    let pathData: string | null = null;
    let cornerRadius = 0;

    if (obj instanceof fabric.Rect) {
      cornerRadius = (obj.rx as number) || 0;
    } else if (obj instanceof fabric.Line) {
      points.push(
        { x: (obj.x1 as number) || 0, y: (obj.y1 as number) || 0 },
        { x: (obj.x2 as number) || 0, y: (obj.y2 as number) || 0 }
      );
    } else if (obj instanceof fabric.Polygon) {
      points.push(...(obj.points?.map((p: any) => ({ x: p.x, y: p.y })) || []));
    } else if (obj instanceof fabric.Path) {
      pathData = (obj.path as any)?.toString() || null;
    }

    return {
      type: "shape",
      shapeType,
      bounds: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      transform: {
        rotation: obj.angle || 0,
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
        skewX: obj.skewX || 0,
        skewY: obj.skewY || 0,
      },
      geometry: {
        points,
        pathData,
        cornerRadius,
      },
      style: {
        fillColor: (obj.fill as string) || null,
        fillOpacity: obj.opacity || 1,
        strokeColor: (obj.stroke as string) || null,
        strokeWidth: obj.strokeWidth || 0,
        strokeOpacity: obj.opacity || 1,
        strokeDashArray: (obj.strokeDashArray as number[]) || [],
      },
      locked: obj.lockMovementX || false,
      visible: obj.visible || true,
    };
  }
}

/**
 * Rectangle shape
 */
export class PDFRectangle extends fabric.Rect {
  elementId?: UUID;
  element?: ShapeElement;

  constructor(options: PDFShapeOptions = {}) {
    super(options);
    this.elementId = options.elementId;
    this.element = options.element;
  }

  toElement(): Partial<ShapeElement> {
    return PDFShape.toElement(this, "rectangle");
  }
}

/**
 * Ellipse shape
 */
export class PDFEllipse extends fabric.Ellipse {
  elementId?: UUID;
  element?: ShapeElement;

  constructor(options: PDFShapeOptions = {}) {
    super(options);
    this.elementId = options.elementId;
    this.element = options.element;
  }

  toElement(): Partial<ShapeElement> {
    return PDFShape.toElement(this, "ellipse");
  }
}

/**
 * Line shape
 */
export class PDFLine extends fabric.Line {
  elementId?: UUID;
  element?: ShapeElement;

  constructor(points: number[], options: PDFShapeOptions = {}) {
    super(points, options);
    this.elementId = options.elementId;
    this.element = options.element;
  }

  toElement(): Partial<ShapeElement> {
    return PDFShape.toElement(this, "line");
  }
}

// Register classes with Fabric.js
