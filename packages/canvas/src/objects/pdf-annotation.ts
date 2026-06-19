/**
 * Custom Fabric.js annotation object for PDF annotation elements
 */

import * as fabric from "fabric";
import type { AnnotationElement, UUID } from "@giga-pdf/types";
import { boundsToFabric, transformToFabric } from "../utils/transform";

// Fabric v6 dropped the `IGroupOptions` namespace; options are now
// `Partial<GroupProps>`. We compose it with our PDF-specific metadata.
export type PDFAnnotationOptions = Partial<fabric.GroupProps> & {
  elementId?: UUID;
  element?: AnnotationElement;
};

/**
 * Custom annotation object for PDF annotation elements
 */
export class PDFAnnotation extends fabric.Group {
  elementId?: UUID;
  element?: AnnotationElement;

  constructor(objects: fabric.Object[], options: PDFAnnotationOptions = {}) {
    super(objects, options as Partial<fabric.GroupProps>);
    this.elementId = options.elementId;
    this.element = options.element;
  }

  /**
   * Create PDFAnnotation from AnnotationElement.
   *
   * Named `fromPdfElement` for consistency with the other PDF object classes.
   */
  static fromPdfElement(element: AnnotationElement): PDFAnnotation {
    const fabricProps = boundsToFabric(element.bounds);
    const fabricTransform = transformToFabric(element.transform);

    const objects: fabric.Object[] = [];

    // Create visual representation based on annotation type
    switch (element.annotationType) {
      case "highlight": {
        const highlight = new fabric.Rect({
          ...fabricProps,
          fill: element.style.color,
          opacity: element.style.opacity * 0.3,
          selectable: false,
        });
        objects.push(highlight);
        break;
      }

      case "underline": {
        const underline = new fabric.Line(
          [
            fabricProps.left,
            fabricProps.top + fabricProps.height,
            fabricProps.left + fabricProps.width,
            fabricProps.top + fabricProps.height,
          ],
          {
            stroke: element.style.color,
            strokeWidth: 2,
            strokeUniform: true,
            opacity: element.style.opacity,
            selectable: false,
          }
        );
        objects.push(underline);
        break;
      }

      case "strikeout": {
        const strikeout = new fabric.Line(
          [
            fabricProps.left,
            fabricProps.top + fabricProps.height / 2,
            fabricProps.left + fabricProps.width,
            fabricProps.top + fabricProps.height / 2,
          ],
          {
            stroke: element.style.color,
            strokeWidth: 2,
            strokeUniform: true,
            opacity: element.style.opacity,
            selectable: false,
          }
        );
        objects.push(strikeout);
        break;
      }

      case "squiggly": {
        const path = `M ${fabricProps.left},${fabricProps.top + fabricProps.height}
          q 5,-5 10,0 t 10,0 t 10,0 t 10,0`;
        const squiggly = new fabric.Path(path, {
          stroke: element.style.color,
          strokeWidth: 1,
          strokeUniform: true,
          fill: undefined,
          opacity: element.style.opacity,
          selectable: false,
        });
        objects.push(squiggly);
        break;
      }

      case "note": {
        const note = new fabric.Circle({
          ...fabricProps,
          radius: Math.min(fabricProps.width, fabricProps.height) / 2,
          fill: element.style.color,
          opacity: element.style.opacity,
          selectable: false,
        });

        const icon = new fabric.Text("📝", {
          left: fabricProps.left,
          top: fabricProps.top,
          fontSize: Math.min(fabricProps.width, fabricProps.height) * 0.6,
          fill: "#ffffff",
          selectable: false,
        });

        objects.push(note, icon);
        break;
      }

      case "freetext": {
        const background = new fabric.Rect({
          ...fabricProps,
          fill: "#ffffff",
          stroke: element.style.color,
          strokeWidth: 1,
          strokeUniform: true,
          opacity: element.style.opacity,
          selectable: false,
        });

        const text = new fabric.Textbox(element.content, {
          ...fabricProps,
          fontSize: 12,
          fill: element.style.color,
          opacity: element.style.opacity,
          selectable: false,
        });

        objects.push(background, text);
        break;
      }

      case "stamp": {
        const stamp = new fabric.Rect({
          ...fabricProps,
          fill: "transparent",
          stroke: element.style.color,
          strokeWidth: 2,
          strokeUniform: true,
          opacity: element.style.opacity,
          selectable: false,
        });

        const text = new fabric.Text(element.content || "STAMP", {
          left: fabricProps.left,
          top: fabricProps.top,
          fontSize: 14,
          fontWeight: "bold",
          fill: element.style.color,
          opacity: element.style.opacity,
          selectable: false,
        });

        objects.push(stamp, text);
        break;
      }

      case "link": {
        const link = new fabric.Rect({
          ...fabricProps,
          fill: "transparent",
          stroke: "#0000FF",
          strokeWidth: 1,
          strokeUniform: true,
          strokeDashArray: [5, 5],
          opacity: 0.5,
          selectable: false,
        });
        objects.push(link);
        break;
      }
    }

    return new PDFAnnotation(objects, {
      elementId: element.elementId,
      element,
      ...fabricTransform,
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
   * Convert PDFAnnotation to AnnotationElement
   */
  toElement(): Partial<AnnotationElement> {
    const bounds = this.getBoundingRect();

    return {
      elementId: this.elementId,
      type: "annotation",
      bounds: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      transform: {
        rotation: this.angle || 0,
        scaleX: this.scaleX || 1,
        scaleY: this.scaleY || 1,
        skewX: this.skewX || 0,
        skewY: this.skewY || 0,
      },
      locked: this.lockMovementX || false,
      visible: this.visible || true,
    };
  }
}

// Register the class with Fabric.js
