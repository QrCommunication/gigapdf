/**
 * Image element renderer
 */

import * as fabric from "fabric";
import type { ImageElement } from "@giga-pdf/types";
import { PDFImage } from "../objects/pdf-image";

/**
 * Render image elements to canvas
 */
export class ImageRenderer {
  /**
   * Render a single image element
   */
  static async renderElement(
    canvas: fabric.Canvas,
    element: ImageElement
  ): Promise<fabric.Object> {
    const imageObject = await PDFImage.fromElement(element);
    canvas.add(imageObject);
    return imageObject;
  }

  /**
   * Render multiple image elements
   */
  static async renderElements(
    canvas: fabric.Canvas,
    elements: ImageElement[]
  ): Promise<fabric.Object[]> {
    const objects: fabric.Object[] = [];

    for (const element of elements) {
      const obj = await this.renderElement(canvas, element);
      objects.push(obj);
    }

    return objects;
  }

  /**
   * Load image from URL
   */
  static async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /**
   * Create image from file
   */
  static async createFromFile(
    canvas: fabric.Canvas,
    file: File,
    x: number = 0,
    y: number = 0
  ): Promise<PDFImage> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const img = await this.loadImage(dataUrl);

        const imageObject = new PDFImage(img, {
          left: x,
          top: y,
        });

        canvas.add(imageObject);
        canvas.setActiveObject(imageObject);
        resolve(imageObject);
      };

      reader.onerror = () => {
        reject(new Error("Failed to read file"));
      };

      reader.readAsDataURL(file);
    });
  }

  /**
   * Create image from URL
   */
  static async createFromURL(
    canvas: fabric.Canvas,
    url: string,
    x: number = 0,
    y: number = 0
  ): Promise<PDFImage> {
    const img = await this.loadImage(url);

    const imageObject = new PDFImage(img, {
      left: x,
      top: y,
    });

    canvas.add(imageObject);
    canvas.setActiveObject(imageObject);
    return imageObject;
  }

  /**
   * Update image element
   */
  static updateElement(
    obj: fabric.Object,
    updates: Partial<ImageElement>
  ): void {
    if (obj instanceof PDFImage) {
      obj.updateElement(updates);
      obj.canvas?.renderAll();
    }
  }

  /**
   * Apply image filters
   */
  static applyFilters(
    obj: fabric.Object,
    filters: {
      brightness?: number;
      contrast?: number;
      saturation?: number;
      blur?: number;
      grayscale?: boolean;
      sepia?: boolean;
      invert?: boolean;
    }
  ): void {
    if (!(obj instanceof fabric.Image)) {
      return;
    }

    const fabricFilters: any[] = [];

    if (filters.brightness !== undefined) {
      fabricFilters.push(
        new fabric.Image.filters.Brightness({ brightness: filters.brightness })
      );
    }
    if (filters.contrast !== undefined) {
      fabricFilters.push(
        new fabric.Image.filters.Contrast({ contrast: filters.contrast })
      );
    }
    if (filters.saturation !== undefined) {
      fabricFilters.push(
        new fabric.Image.filters.Saturation({ saturation: filters.saturation })
      );
    }
    if (filters.blur !== undefined) {
      fabricFilters.push(
        new fabric.Image.filters.Blur({ blur: filters.blur })
      );
    }
    if (filters.grayscale) {
      fabricFilters.push(new fabric.Image.filters.Grayscale());
    }
    if (filters.sepia) {
      fabricFilters.push(new fabric.Image.filters.Sepia());
    }
    if (filters.invert) {
      fabricFilters.push(new fabric.Image.filters.Invert());
    }

    obj.filters = fabricFilters;
    obj.applyFilters();
    obj.canvas?.renderAll();
  }

  /**
   * Crop image
   */
  static cropImage(
    obj: fabric.Object,
    crop: { x: number; y: number; width: number; height: number }
  ): void {
    if (obj instanceof PDFImage) {
      obj.applyCrop(crop);
      obj.canvas?.renderAll();
    }
  }

  /**
   * Reset image crop
   */
  static resetCrop(obj: fabric.Object): void {
    if (!(obj instanceof fabric.Image)) {
      return;
    }

    obj.set({
      cropX: 0,
      cropY: 0,
      width: obj.width,
      height: obj.height,
    });
    obj.canvas?.renderAll();
  }

  /**
   * Get image data URL
   */
  static getDataURL(obj: fabric.Object, format: string = "png"): string | null {
    if (!(obj instanceof fabric.Image)) {
      return null;
    }

    return obj.toDataURL({ format });
  }

  /**
   * Resize image maintaining aspect ratio
   */
  static resizeToFit(
    obj: fabric.Object,
    maxWidth: number,
    maxHeight: number
  ): void {
    if (!(obj instanceof fabric.Image)) {
      return;
    }

    const width = obj.width || 0;
    const height = obj.height || 0;

    const scale = Math.min(maxWidth / width, maxHeight / height, 1);

    obj.set({
      scaleX: scale,
      scaleY: scale,
    });

    obj.canvas?.renderAll();
  }
}
