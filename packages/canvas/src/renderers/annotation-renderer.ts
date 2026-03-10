/**
 * Annotation element renderer
 */

import * as fabric from "fabric";
import type { AnnotationElement } from "@giga-pdf/types";
import { PDFAnnotation } from "../objects/pdf-annotation";

/**
 * Render annotation elements to canvas
 */
export class AnnotationRenderer {
  /**
   * Render a single annotation element
   */
  static async renderElement(
    canvas: fabric.Canvas,
    element: AnnotationElement
  ): Promise<fabric.Object> {
    const annotationObject = PDFAnnotation.fromElement(element);
    canvas.add(annotationObject);
    return annotationObject;
  }

  /**
   * Render multiple annotation elements
   */
  static async renderElements(
    canvas: fabric.Canvas,
    elements: AnnotationElement[]
  ): Promise<fabric.Object[]> {
    const objects: fabric.Object[] = [];

    for (const element of elements) {
      const obj = await this.renderElement(canvas, element);
      objects.push(obj);
    }

    return objects;
  }

  /**
   * Create highlight annotation
   */
  static createHighlight(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string = "#FFFF00"
  ): fabric.Rect {
    const highlight = new fabric.Rect({
      left: x,
      top: y,
      width,
      height,
      fill: color,
      opacity: 0.3,
      selectable: true,
    });

    canvas.add(highlight);
    return highlight;
  }

  /**
   * Create underline annotation
   */
  static createUnderline(
    canvas: fabric.Canvas,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string = "#FF0000"
  ): fabric.Line {
    const underline = new fabric.Line([x1, y1, x2, y2], {
      stroke: color,
      strokeWidth: 2,
      selectable: true,
    });

    canvas.add(underline);
    return underline;
  }

  /**
   * Create strikeout annotation
   */
  static createStrikeout(
    canvas: fabric.Canvas,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string = "#FF0000"
  ): fabric.Line {
    const strikeout = new fabric.Line([x1, y1, x2, y2], {
      stroke: color,
      strokeWidth: 2,
      selectable: true,
    });

    canvas.add(strikeout);
    return strikeout;
  }

  /**
   * Create note annotation
   */
  static createNote(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    content: string = "",
    color: string = "#FFFF00"
  ): fabric.Group {
    const circle = new fabric.Circle({
      radius: 12,
      fill: color,
      left: 0,
      top: 0,
    });

    const text = new fabric.Text("📝", {
      fontSize: 16,
      left: -8,
      top: -8,
    });

    const group = new fabric.Group([circle, text], {
      left: x,
      top: y,
      selectable: true,
    });

    canvas.add(group);
    return group;
  }

  /**
   * Create freetext annotation
   */
  static createFreetext(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string = "",
    color: string = "#000000"
  ): fabric.Group {
    const background = new fabric.Rect({
      width,
      height,
      fill: "#FFFFFF",
      stroke: color,
      strokeWidth: 1,
      left: 0,
      top: 0,
    });

    const textbox = new fabric.Textbox(text, {
      width,
      fontSize: 12,
      fill: color,
      left: 5,
      top: 5,
    });

    const group = new fabric.Group([background, textbox], {
      left: x,
      top: y,
      selectable: true,
    });

    canvas.add(group);
    return group;
  }

  /**
   * Create stamp annotation
   */
  static createStamp(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    stampText: string = "APPROVED",
    color: string = "#FF0000"
  ): fabric.Group {
    const rect = new fabric.Rect({
      width: 100,
      height: 40,
      fill: "transparent",
      stroke: color,
      strokeWidth: 2,
      left: 0,
      top: 0,
    });

    const text = new fabric.Text(stampText, {
      fontSize: 14,
      fontWeight: "bold",
      fill: color,
      left: 10,
      top: 10,
    });

    const group = new fabric.Group([rect, text], {
      left: x,
      top: y,
      selectable: true,
    });

    canvas.add(group);
    return group;
  }

  /**
   * Create link annotation
   */
  static createLink(
    canvas: fabric.Canvas,
    x: number,
    y: number,
    width: number,
    height: number,
    url: string
  ): fabric.Rect {
    const link = new fabric.Rect({
      left: x,
      top: y,
      width,
      height,
      fill: "transparent",
      stroke: "#0000FF",
      strokeWidth: 1,
      strokeDashArray: [5, 5],
      opacity: 0.5,
      selectable: true,
    });

    // Store URL as custom property
    (link as any).linkUrl = url;

    canvas.add(link);
    return link;
  }

  /**
   * Update annotation content
   */
  static updateContent(obj: fabric.Object, content: string): void {
    if (obj instanceof fabric.Group) {
      const textObject = obj.getObjects().find((o) => o instanceof fabric.Textbox || o instanceof fabric.Text);
      if (textObject instanceof fabric.Textbox || textObject instanceof fabric.Text) {
        textObject.set("text", content);
        obj.canvas?.renderAll();
      }
    }
  }

  /**
   * Update annotation color
   */
  static updateColor(obj: fabric.Object, color: string): void {
    obj.set({
      fill: color,
      stroke: color,
    });
    obj.canvas?.renderAll();
  }
}
