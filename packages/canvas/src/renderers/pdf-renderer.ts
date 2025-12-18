/**
 * PDF.js integration for rendering PDF pages to canvas
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PageObject } from "@giga-pdf/types";

// Configure PDF.js worker
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
}

export interface PDFRenderOptions {
  scale?: number;
  rotation?: 0 | 90 | 180 | 270;
  renderAnnotations?: boolean;
  renderTextLayer?: boolean;
}

export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): void;
}

export interface PDFPageProxy {
  pageNumber: number;
  rotate: number;
  view: number[];
  getViewport(params: { scale: number; rotation?: number }): PDFPageViewport;
  render(params: PDFRenderParams): PDFRenderTask;
  getTextContent(): Promise<any>;
  getAnnotations(): Promise<any[]>;
}

export interface PDFPageViewport {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  transform: number[];
  clone(params?: { scale?: number; rotation?: number }): PDFPageViewport;
}

export interface PDFRenderParams {
  canvasContext: CanvasRenderingContext2D;
  viewport: PDFPageViewport;
  renderInteractiveForms?: boolean;
}

export interface PDFRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

/**
 * PDF renderer class
 */
export class PDFRenderer {
  private pdfDoc: PDFDocumentProxy | null = null;
  private pageCache: Map<number, PDFPageProxy> = new Map();

  /**
   * Load PDF document from URL or ArrayBuffer
   */
  async loadDocument(source: string | ArrayBuffer): Promise<void> {
    try {
      const loadingTask = pdfjsLib.getDocument(source as any);
      this.pdfDoc = await loadingTask.promise as unknown as PDFDocumentProxy;
    } catch (error) {
      throw new Error(`Failed to load PDF document: ${error}`);
    }
  }

  /**
   * Get total number of pages
   */
  getPageCount(): number {
    if (!this.pdfDoc) {
      throw new Error("PDF document not loaded");
    }
    return this.pdfDoc.numPages;
  }

  /**
   * Get PDF page
   */
  async getPage(pageNumber: number): Promise<PDFPageProxy> {
    if (!this.pdfDoc) {
      throw new Error("PDF document not loaded");
    }

    if (this.pageCache.has(pageNumber)) {
      return this.pageCache.get(pageNumber)!;
    }

    const page = await this.pdfDoc.getPage(pageNumber);
    this.pageCache.set(pageNumber, page);
    return page;
  }

  /**
   * Render PDF page to canvas
   */
  async renderPage(
    canvas: HTMLCanvasElement,
    pageNumber: number,
    options: PDFRenderOptions = {}
  ): Promise<void> {
    const {
      scale = 1,
      rotation = 0,
      renderAnnotations = false,
    } = options;

    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });

    // Set canvas dimensions
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to get canvas context");
    }

    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Render page
    const renderTask = page.render({
      canvasContext: context,
      viewport,
      renderInteractiveForms: renderAnnotations,
    });

    await renderTask.promise;
  }

  /**
   * Render PDF page to data URL
   */
  async renderPageToDataURL(
    pageNumber: number,
    options: PDFRenderOptions = {}
  ): Promise<string> {
    const canvas = document.createElement("canvas");
    await this.renderPage(canvas, pageNumber, options);
    return canvas.toDataURL("image/png");
  }

  /**
   * Get page dimensions
   */
  async getPageDimensions(
    pageNumber: number,
    scale: number = 1
  ): Promise<{ width: number; height: number }> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    return {
      width: viewport.width,
      height: viewport.height,
    };
  }

  /**
   * Extract text content from page
   */
  async getPageText(pageNumber: number): Promise<string> {
    const page = await this.getPage(pageNumber);
    const textContent = await page.getTextContent();
    return textContent.items.map((item: any) => item.str).join(" ");
  }

  /**
   * Extract annotations from page
   */
  async getPageAnnotations(pageNumber: number): Promise<any[]> {
    const page = await this.getPage(pageNumber);
    return await page.getAnnotations();
  }

  /**
   * Create thumbnail for page
   */
  async createThumbnail(
    pageNumber: number,
    maxWidth: number,
    maxHeight: number
  ): Promise<string> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });

    // Calculate scale to fit thumbnail dimensions
    const scale = Math.min(
      maxWidth / viewport.width,
      maxHeight / viewport.height
    );

    return this.renderPageToDataURL(pageNumber, { scale });
  }

  /**
   * Render page object to canvas
   */
  async renderPageObject(
    canvas: HTMLCanvasElement,
    pageObject: PageObject,
    scale: number = 1
  ): Promise<void> {
    await this.renderPage(canvas, pageObject.pageNumber, {
      scale,
      rotation: pageObject.dimensions.rotation,
    });
  }

  /**
   * Dispose of PDF document and free resources
   */
  dispose(): void {
    this.pageCache.clear();
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
  }
}

/**
 * Create a new PDF renderer instance
 */
export function createPDFRenderer(): PDFRenderer {
  return new PDFRenderer();
}
