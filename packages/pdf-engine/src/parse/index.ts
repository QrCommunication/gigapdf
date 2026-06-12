export { parseDocument, parsePage, parseMetadata, parseBookmarks } from './parser';
export type { ParseOptions, ParsePageOptions } from './parser';

// MuPDF-powered extractors (structured text, search, robust metadata, OCR)
export {
  extractStructuredText,
  extractPlainText,
} from './structured-text';
export type {
  StructuredChar,
  StructuredLine,
  StructuredBlock,
  StructuredPage,
  ExtractStructuredTextOptions,
} from './structured-text';

export { searchPdf } from './search';
export type { SearchHit, SearchOptions, SearchResult } from './search';

export { getMetadataRobust } from './metadata-robust';

export { ocrPdf, isTesseractAvailable, TesseractNotInstalledError } from './ocr';
export type { OcrOptions, OcrPageResult, OcrResult } from './ocr';

export {
  makeSearchablePdf,
  parseTsvWords,
  tsvWordToPdfPlacement,
  DEFAULT_MIN_WORD_CONFIDENCE,
} from './ocr-searchable';
export type {
  MakeSearchablePdfOptions,
  MakeSearchablePdfResult,
  OcrTsvWord,
  PdfPlacementContext,
  PdfWordPlacement,
} from './ocr-searchable';
