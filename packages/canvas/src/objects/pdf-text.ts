/**
 * Custom Fabric.js text object for PDF text elements
 */

import * as fabric from "fabric";
import type { TextElement, UUID } from "@giga-pdf/types";
import { boundsToFabric, transformToFabric } from "../utils/transform";

export interface PDFTextOptions extends fabric.ITextboxOptions {
  elementId?: UUID;
  element?: TextElement;
}

/**
 * Custom text object for PDF text elements
 */
export class PDFText extends fabric.Textbox {
  elementId?: UUID;
  element?: TextElement;

  constructor(text: string, options: PDFTextOptions = {}) {
    super(text, {
      ...options,
      editable: true,
      splitByGrapheme: true,
    });

    this.elementId = options.elementId;
    this.element = options.element;
  }

  /**
   * Create PDFText from TextElement
   */
  static fromElement(element: TextElement): PDFText {
    const fabricProps = boundsToFabric(element.bounds);
    const fabricTransform = transformToFabric(element.transform);

    return new PDFText(element.content, {
      elementId: element.elementId,
      element,
      ...fabricProps,
      ...fabricTransform,
      fontFamily: element.style.fontFamily,
      fontSize: element.style.fontSize,
      fontWeight: element.style.fontWeight,
      fontStyle: element.style.fontStyle,
      fill: element.style.color,
      opacity: element.style.opacity,
      textAlign: element.style.textAlign,
      lineHeight: element.style.lineHeight,
      charSpacing: element.style.letterSpacing,
      selectable: !element.locked,
      visible: element.visible,
      lockMovementX: element.locked,
      lockMovementY: element.locked,
      lockRotation: element.locked,
      lockScalingX: element.locked,
      lockScalingY: element.locked,
    });
  }

  /**
   * Convert PDFText to TextElement
   */
  toElement(): Partial<TextElement> {
    return {
      elementId: this.elementId,
      type: "text",
      content: this.text || "",
      bounds: {
        x: this.left || 0,
        y: this.top || 0,
        width: this.width || 0,
        height: this.height || 0,
      },
      transform: {
        rotation: this.angle || 0,
        scaleX: this.scaleX || 1,
        scaleY: this.scaleY || 1,
        skewX: this.skewX || 0,
        skewY: this.skewY || 0,
      },
      style: {
        fontFamily: this.fontFamily || "Arial",
        fontSize: this.fontSize || 16,
        fontWeight: (this.fontWeight as "normal" | "bold") || "normal",
        fontStyle: (this.fontStyle as "normal" | "italic") || "normal",
        color: (this.fill as string) || "#000000",
        opacity: this.opacity || 1,
        textAlign: (this.textAlign as any) || "left",
        lineHeight: this.lineHeight || 1.16,
        letterSpacing: this.charSpacing || 0,
        writingMode: "horizontal-tb",
      },
      locked: this.lockMovementX || false,
      visible: this.visible || true,
    };
  }

  /**
   * Update element data
   */
  updateElement(element: Partial<TextElement>): void {
    if (element.content !== undefined) {
      this.set("text", element.content);
    }
    if (element.bounds) {
      this.set({
        left: element.bounds.x,
        top: element.bounds.y,
        width: element.bounds.width,
        height: element.bounds.height,
      });
    }
    if (element.transform) {
      this.set({
        angle: element.transform.rotation,
        scaleX: element.transform.scaleX,
        scaleY: element.transform.scaleY,
        skewX: element.transform.skewX,
        skewY: element.transform.skewY,
      });
    }
    if (element.style) {
      this.set({
        fontFamily: element.style.fontFamily,
        fontSize: element.style.fontSize,
        fontWeight: element.style.fontWeight,
        fontStyle: element.style.fontStyle,
        fill: element.style.color,
        opacity: element.style.opacity,
        textAlign: element.style.textAlign,
        lineHeight: element.style.lineHeight,
        charSpacing: element.style.letterSpacing,
      });
    }
    if (element.locked !== undefined) {
      this.set({
        selectable: !element.locked,
        lockMovementX: element.locked,
        lockMovementY: element.locked,
        lockRotation: element.locked,
        lockScalingX: element.locked,
        lockScalingY: element.locked,
      });
    }
    if (element.visible !== undefined) {
      this.set("visible", element.visible);
    }
  }
}

// Register the class with Fabric.js
