/**
 * Text tool for creating and editing text
 */

import * as fabric from "fabric";
import { PDFText } from "../objects/pdf-text";
import type { TextStyle } from "@giga-pdf/types";

export interface TextToolOptions {
  defaultStyle?: Partial<TextStyle>;
  autoFocus?: boolean;
}

/**
 * Text tool class
 */
export class TextTool {
  private canvas: fabric.Canvas;
  private options: TextToolOptions;
  private isActive: boolean = false;

  constructor(canvas: fabric.Canvas, options: TextToolOptions = {}) {
    this.canvas = canvas;
    this.options = {
      autoFocus: true,
      ...options,
    };
  }

  /**
   * Activate text tool
   */
  activate(): void {
    this.isActive = true;
    this.canvas.defaultCursor = "text";
    this.canvas.selection = false;

    this.attachEvents();
  }

  /**
   * Deactivate text tool
   */
  deactivate(): void {
    this.isActive = false;
    this.canvas.defaultCursor = "default";
    this.canvas.selection = true;

    this.detachEvents();
  }

  /**
   * Attach event handlers
   */
  private attachEvents(): void {
    this.canvas.on("mouse:down", this.onMouseDown);
  }

  /**
   * Detach event handlers
   */
  private detachEvents(): void {
    this.canvas.off("mouse:down", this.onMouseDown);
  }

  /**
   * Handle mouse down
   */
  private onMouseDown = (e: fabric.IEvent): void => {
    if (!this.isActive) return;

    const pointer = this.canvas.getPointer(e.e);
    this.createTextBox(pointer.x, pointer.y);
  };

  /**
   * Create text box at position
   */
  createTextBox(x: number, y: number, text: string = ""): PDFText {
    const defaultStyle = this.options.defaultStyle || {};

    const textBox = new PDFText(text, {
      left: x,
      top: y,
      width: 200,
      fontSize: defaultStyle.fontSize || 16,
      fontFamily: defaultStyle.fontFamily || "Arial",
      fontWeight: defaultStyle.fontWeight || "normal",
      fontStyle: defaultStyle.fontStyle || "normal",
      fill: defaultStyle.color || "#000000",
      textAlign: defaultStyle.textAlign || "left",
      lineHeight: defaultStyle.lineHeight || 1.16,
      charSpacing: defaultStyle.letterSpacing || 0,
    });

    this.canvas.add(textBox);
    this.canvas.setActiveObject(textBox);

    if (this.options.autoFocus) {
      textBox.enterEditing();
      textBox.selectAll();
    }

    this.canvas.renderAll();

    return textBox;
  }

  /**
   * Create text with content
   */
  createText(x: number, y: number, content: string, style?: Partial<TextStyle>): PDFText {
    const mergedStyle = { ...this.options.defaultStyle, ...style };

    const textBox = new PDFText(content, {
      left: x,
      top: y,
      width: 200,
      fontSize: mergedStyle.fontSize || 16,
      fontFamily: mergedStyle.fontFamily || "Arial",
      fontWeight: mergedStyle.fontWeight || "normal",
      fontStyle: mergedStyle.fontStyle || "normal",
      fill: mergedStyle.color || "#000000",
      textAlign: mergedStyle.textAlign || "left",
      lineHeight: mergedStyle.lineHeight || 1.16,
      charSpacing: mergedStyle.letterSpacing || 0,
      opacity: mergedStyle.opacity || 1,
    });

    this.canvas.add(textBox);
    this.canvas.renderAll();

    return textBox;
  }

  /**
   * Edit text object
   */
  editText(obj: fabric.Object): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof PDFText)) {
      return;
    }

    this.canvas.setActiveObject(obj);
    obj.enterEditing();
    obj.selectAll();
  }

  /**
   * Update text style
   */
  updateStyle(obj: fabric.Object, style: Partial<TextStyle>): void {
    if (!(obj instanceof fabric.Textbox && obj instanceof fabric.Text)) {
      return;
    }

    const updates: any = {};

    if (style.fontFamily) updates.fontFamily = style.fontFamily;
    if (style.fontSize) updates.fontSize = style.fontSize;
    if (style.fontWeight) updates.fontWeight = style.fontWeight;
    if (style.fontStyle) updates.fontStyle = style.fontStyle;
    if (style.color) updates.fill = style.color;
    if (style.textAlign) updates.textAlign = style.textAlign;
    if (style.lineHeight) updates.lineHeight = style.lineHeight;
    if (style.letterSpacing) updates.charSpacing = style.letterSpacing;
    if (style.opacity !== undefined) updates.opacity = style.opacity;

    obj.set(updates);
    this.canvas.renderAll();
  }

  /**
   * Apply formatting to selected text
   */
  applyFormatting(
    obj: fabric.Object,
    format: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      linethrough?: boolean;
    }
  ): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof fabric.Text)) {
      return;
    }

    if (format.bold !== undefined) {
      obj.set("fontWeight", format.bold ? "bold" : "normal");
    }
    if (format.italic !== undefined) {
      obj.set("fontStyle", format.italic ? "italic" : "normal");
    }
    if (format.underline !== undefined) {
      obj.set("underline", format.underline);
    }
    if (format.linethrough !== undefined) {
      obj.set("linethrough", format.linethrough);
    }

    this.canvas.renderAll();
  }

  /**
   * Change text alignment
   */
  setAlignment(obj: fabric.Object, alignment: "left" | "center" | "right" | "justify"): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof fabric.Text)) {
      return;
    }

    obj.set("textAlign", alignment);
    this.canvas.renderAll();
  }

  /**
   * Change font size
   */
  setFontSize(obj: fabric.Object, fontSize: number): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof fabric.Text)) {
      return;
    }

    obj.set("fontSize", fontSize);
    this.canvas.renderAll();
  }

  /**
   * Change font family
   */
  setFontFamily(obj: fabric.Object, fontFamily: string): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof fabric.Text)) {
      return;
    }

    obj.set("fontFamily", fontFamily);
    this.canvas.renderAll();
  }

  /**
   * Change text color
   */
  setColor(obj: fabric.Object, color: string): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof fabric.Text)) {
      return;
    }

    obj.set("fill", color);
    this.canvas.renderAll();
  }

  /**
   * Get text content
   */
  getContent(obj: fabric.Object): string {
    if (obj instanceof fabric.Textbox || obj instanceof fabric.Text) {
      return obj.text || "";
    }
    return "";
  }

  /**
   * Set text content
   */
  setContent(obj: fabric.Object, content: string): void {
    if (!(obj instanceof fabric.Textbox || obj instanceof fabric.Text)) {
      return;
    }

    obj.set("text", content);
    this.canvas.renderAll();
  }
}
