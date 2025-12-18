/**
 * Custom Fabric.js image object for PDF image elements
 */

import * as fabric from "fabric";
import type { ImageElement, UUID } from "@giga-pdf/types";
import { boundsToFabric, transformToFabric } from "../utils/transform";

export interface PDFImageOptions extends fabric.IImageOptions {
  elementId?: UUID;
  element?: ImageElement;
}

/**
 * Custom image object for PDF image elements
 */
export class PDFImage extends fabric.Image {
  elementId?: UUID;
  element?: ImageElement;

  constructor(element: HTMLImageElement | HTMLCanvasElement, options: PDFImageOptions = {}) {
    super(element, options);

    this.elementId = options.elementId;
    this.element = options.element;
  }

  /**
   * Create PDFImage from ImageElement
   */
  static async fromElement(element: ImageElement): Promise<PDFImage> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        const fabricProps = boundsToFabric(element.bounds);
        const fabricTransform = transformToFabric(element.transform);

        const pdfImage = new PDFImage(img, {
          elementId: element.elementId,
          element,
          ...fabricProps,
          ...fabricTransform,
          opacity: element.style.opacity,
          selectable: !element.locked,
          visible: element.visible,
          lockMovementX: element.locked,
          lockMovementY: element.locked,
          lockRotation: element.locked,
          lockScalingX: element.locked,
          lockScalingY: element.locked,
        });

        // Apply crop if specified
        if (element.crop) {
          pdfImage.set({
            cropX: element.crop.x,
            cropY: element.crop.y,
            width: element.crop.width,
            height: element.crop.height,
          });
        }

        resolve(pdfImage);
      };

      img.onerror = () => {
        reject(new Error(`Failed to load image: ${element.source.dataUrl}`));
      };

      img.src = element.source.dataUrl;
    });
  }

  /**
   * Convert PDFImage to ImageElement
   */
  toElement(): Partial<ImageElement> {
    return {
      elementId: this.elementId,
      type: "image",
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
        opacity: this.opacity || 1,
        blendMode: "normal",
      },
      crop: this.cropX || this.cropY
        ? {
            x: this.cropX || 0,
            y: this.cropY || 0,
            width: this.width || 0,
            height: this.height || 0,
          }
        : null,
      locked: this.lockMovementX || false,
      visible: this.visible || true,
    };
  }

  /**
   * Update element data
   */
  updateElement(element: Partial<ImageElement>): void {
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
        opacity: element.style.opacity,
      });
    }
    if (element.crop) {
      this.set({
        cropX: element.crop.x,
        cropY: element.crop.y,
        width: element.crop.width,
        height: element.crop.height,
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

  /**
   * Apply crop to image
   */
  applyCrop(crop: { x: number; y: number; width: number; height: number }): void {
    this.set({
      cropX: crop.x,
      cropY: crop.y,
      width: crop.width,
      height: crop.height,
    });
  }
}

// Register the class with Fabric.js
