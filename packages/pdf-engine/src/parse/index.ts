export { parseDocument, parsePage, parseMetadata, parseBookmarks } from './parser';
export type { ParseOptions, ParsePageOptions } from './parser';

// Structural block grouping (native engine `pageBlocks` → editor coalescing).
export {
  extractPageBlockGroups,
  extractPageBlockGroupsByPage,
  gigaBlocksToPageBlockGroups,
} from './block-extractor';
export type { PageBlockGroup } from './block-extractor';

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

// Host-side OCR service client (recognition over HTTP). `OCR_LANGUAGES` /
// `OcrLanguage` replace the engine's former `ALL_OCR_SCRIPTS` / `OcrScript` as
// the stable vocabulary symbol for importers.
export { OCR_LANGUAGES, listOcrLanguages, getOcrWords, getOcrServiceUrl } from '../ocr-engine';
export type { OcrLanguage, NativeOcrWord } from '../ocr-engine';

export { makeSearchablePdf, ocrWordToPdfPlacement } from './ocr-searchable';
export type {
  MakeSearchablePdfOptions,
  MakeSearchablePdfResult,
  OcrWordBox,
  PdfPlacementContext,
  PdfWordPlacement,
} from './ocr-searchable';

export { makeEditableOcrPdf, sampleBackgroundColor } from './ocr-editable';
export type {
  MakeEditableOcrPdfOptions,
  MakeEditableOcrPdfResult,
} from './ocr-editable';

export { extractOcrBlocks, ocrWordToPdfBox, pdfBoxToImageRect } from './ocr-blocks';
export type {
  OcrBlock,
  ExtractOcrBlocksOptions,
  ExtractOcrBlocksResult,
} from './ocr-blocks';
