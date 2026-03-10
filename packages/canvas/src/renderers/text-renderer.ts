/**
 * Text element renderer
 */

import * as fabric from "fabric";
import type { TextElement } from "@giga-pdf/types";
import { PDFText } from "../objects/pdf-text";

/**
 * Render text elements to canvas
 */
export class TextRenderer {
  /**
   * Render a single text element
   */
  static async renderElement(
    canvas: fabric.Canvas,
    element: TextElement
  ): Promise<fabric.Object> {
    const textObject = PDFText.fromElement(element);
    canvas.add(textObject);
    return textObject;
  }

  /**
   * Render multiple text elements
   */
  static async renderElements(
    canvas: fabric.Canvas,
    elements: TextElement[]
  ): Promise<fabric.Object[]> {
    const objects: fabric.Object[] = [];

    for (const element of elements) {
      const obj = await this.renderElement(canvas, element);
      objects.push(obj);
    }

    return objects;
  }

  /**
   * Create a new text element at position
   */
  static createText(
    canvas: fabric.Canvas,
    text: string,
    x: number,
    y: number,
    options: Partial<fabric.ITextboxOptions> = {}
  ): PDFText {
    const textObject = new PDFText(text, {
      left: x,
      top: y,
      width: 200,
      fontSize: 16,
      fontFamily: "Arial",
      fill: "#000000",
      ...options,
    });

    canvas.add(textObject);
    canvas.setActiveObject(textObject);
    return textObject;
  }

  /**
   * Update text element
   */
  static updateElement(
    obj: fabric.Object,
    updates: Partial<TextElement>
  ): void {
    if (obj instanceof PDFText) {
      obj.updateElement(updates);
      obj.canvas?.renderAll();
    }
  }

  /**
   * Get text metrics
   */
  static getTextMetrics(
    text: string,
    fontFamily: string,
    fontSize: number
  ): { width: number; height: number } {
    const tempText = new fabric.Text(text, {
      fontFamily,
      fontSize,
    });

    return {
      width: tempText.width || 0,
      height: tempText.height || 0,
    };
  }

  /**
   * Apply text formatting
   */
  static applyFormatting(
    obj: fabric.Object,
    formatting: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      linethrough?: boolean;
      fontSize?: number;
      fontFamily?: string;
      color?: string;
      textAlign?: "left" | "center" | "right" | "justify";
    }
  ): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof fabric.Text)) {
      return;
    }

    if (formatting.bold !== undefined) {
      obj.set("fontWeight", formatting.bold ? "bold" : "normal");
    }
    if (formatting.italic !== undefined) {
      obj.set("fontStyle", formatting.italic ? "italic" : "normal");
    }
    if (formatting.underline !== undefined) {
      obj.set("underline", formatting.underline);
    }
    if (formatting.linethrough !== undefined) {
      obj.set("linethrough", formatting.linethrough);
    }
    if (formatting.fontSize !== undefined) {
      obj.set("fontSize", formatting.fontSize);
    }
    if (formatting.fontFamily !== undefined) {
      obj.set("fontFamily", formatting.fontFamily);
    }
    if (formatting.color !== undefined) {
      obj.set("fill", formatting.color);
    }
    if (formatting.textAlign !== undefined) {
      obj.set("textAlign", formatting.textAlign);
    }

    obj.canvas?.renderAll();
  }

  /**
   * Measure text width
   */
  static measureText(
    text: string,
    fontFamily: string,
    fontSize: number
  ): number {
    const tempText = new fabric.Text(text, {
      fontFamily,
      fontSize,
    });
    return tempText.width || 0;
  }

  /**
   * Split text into lines
   */
  static splitTextIntoLines(
    text: string,
    maxWidth: number,
    fontFamily: string,
    fontSize: number
  ): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = this.measureText(testLine, fontFamily, fontSize);

      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }
}
