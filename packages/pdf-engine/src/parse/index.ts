export { parseDocument, parsePage, parseMetadata, parseBookmarks } from './parser';
export type { ParseOptions, ParsePageOptions } from './parser';

// Engine-powered extractors (structured text, search, robust metadata, OCR)
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

export { ocrPdf, isOcrAvailable, OcrUnavailableError } from './ocr';
export type { OcrOptions, OcrPageResult, OcrResult } from './ocr';

export { makeSearchablePdf, ocrWordToPdfPlacement } from './ocr-searchable';
export type {
  MakeSearchablePdfOptions,
  MakeSearchablePdfResult,
  OcrWordBox,
  PdfPlacementContext,
  PdfWordPlacement,
} from './ocr-searchable';

export { extractOcrBlocks, ocrWordToPdfBox, pdfBoxToImageRect } from './ocr-blocks';
export type {
  OcrBlock,
  ExtractOcrBlocksOptions,
  ExtractOcrBlocksResult,
} from './ocr-blocks';
