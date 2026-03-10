/**
 * Page models matching backend Pydantic schemas.
 */

import type { UUID, Dimensions } from "./common";
import type { Element } from "./elements";

export interface MediaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PagePreview {
  thumbnailUrl: string | null;
  fullUrl: string | null;
}

export interface PageObject {
  pageId: UUID;
  pageNumber: number;
  dimensions: Dimensions & { rotation: 0 | 90 | 180 | 270 };
  mediaBox: MediaBox;
  cropBox: MediaBox | null;
  elements: Element[];
  preview: PagePreview;
}

export interface PageSummary {
  pageNumber: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  thumbnailUrl: string | null;
}

export type PreviewFormat = "png" | "jpeg" | "webp" | "svg";

export interface PreviewOptions {
  format?: PreviewFormat;
  dpi?: number;
  quality?: number;
  scale?: number;
}
