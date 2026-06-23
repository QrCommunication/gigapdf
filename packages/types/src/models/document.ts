/**
 * Document models matching backend Pydantic schemas.
 */

import type { UUID } from "./common";
import type { PageObject } from "./page";
import type { LayerObject } from "./elements";

export interface DocumentPermissions {
  print: boolean;
  modify: boolean;
  copy: boolean;
  annotate: boolean;
  fillForms: boolean;
  extract: boolean;
  assemble: boolean;
  printHighQuality: boolean;
}

export interface DocumentMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string[];
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number;
  pdfVersion: string;
  isEncrypted: boolean;
  permissions: DocumentPermissions;
}

export interface BookmarkDestination {
  pageNumber: number;
  position: { x: number; y: number } | null;
  zoom: number | "fit" | "fit-width" | "fit-height" | null;
}

export interface BookmarkStyle {
  bold: boolean;
  italic: boolean;
  color: string;
}

export interface BookmarkObject {
  bookmarkId: UUID;
  title: string;
  destination: BookmarkDestination;
  style: BookmarkStyle;
  children: BookmarkObject[];
}

export interface EmbeddedFileObject {
  fileId: UUID;
  name: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  dataUrl: string;
}

export interface NamedDestination {
  name: string;
  pageNumber: number;
  position: { x: number; y: number } | null;
  zoom: number | null;
}

/**
 * Best-effort reading direction / dominant script of a document's text,
 * derived from the parsed glyphs by the native engine. Surfaced read-only in
 * the editor (a small badge) and used to pre-select the OCR writing system.
 */
export interface DocumentLanguageInfo {
  /** Overall reading direction (`rtl` for Arabic/Hebrew, `ltr` otherwise). */
  direction: "ltr" | "rtl" | "neutral";
  /**
   * Dominant writing system, one of:
   * `"arabic" | "hebrew" | "latin" | "greek" | "cyrillic" | "cjk" | "other"`.
   */
  script: string;
  /** Best-effort ISO-639-1 code (e.g. `"ar"`, `"he"`, `"zh"`); absent when undecidable. */
  lang?: string;
}

export interface DocumentObject {
  documentId: UUID;
  metadata: DocumentMetadata;
  pages: PageObject[];
  outlines: BookmarkObject[];
  namedDestinations: Record<string, NamedDestination>;
  embeddedFiles: EmbeddedFileObject[];
  layers: LayerObject[];
  /**
   * Detected reading direction / dominant script. Optional: omitted by older
   * parse responses and when detection is undecidable (empty/imageful docs).
   */
  documentLanguage?: DocumentLanguageInfo;
}

export interface DocumentSummary {
  documentId: UUID;
  title: string | null;
  pageCount: number;
  isEncrypted: boolean;
  createdAt: string;
}
