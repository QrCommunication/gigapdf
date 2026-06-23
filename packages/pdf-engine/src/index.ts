// Engine
export {
  openDocument,
  closeDocument,
  saveDocument,
  getMetadata,
  setMetadata,
  addPage,
  deletePage,
  movePage,
  rotatePage,
  copyPage,
  resizePage,
  extractPages,
} from './engine';
export type {
  PDFDocumentHandle,
  OpenDocumentOptions,
  SaveDocumentOptions,
  PageDimensions,
} from './engine';

// Parse
export { parseDocument } from './parse';
export type { ParseOptions } from './parse';

// Extract — rich standalone APIs
export { extractTextBlocks } from './parse/text-extractor';
export type { TextBlock } from './parse/text-extractor';
export { extractImages } from './parse/image-extractor';
export type { ExtractedImage, ExtractImagesOptions } from './parse/image-extractor';

// Render
export {
  addText,
  addImage,
  addShape,
  addAnnotation,
  addFormField,
  updateFormFieldValue,
  flattenAnnotations,
  flattenForms,
  applyRedactions,
  applyOperations,
  optimizeAndSave,
  convertToPdfA,
  PdfAConversionError,
  addNativeAnnotations,
  engineRenderPage,
  engineRenderPages,
  addWatermark,
} from './render';
export type {
  RedactionTarget,
  ApplyRedactionsResult,
  ElementOperation,
  ApplyOperationsOptions,
  ApplyOperationsResult,
  OptimizeSaveOptions,
  OptimizeSaveResult,
  PdfAVariant,
  PdfAConversionResult,
  NativeAnnotationType,
  NativeAnnotationSpec,
  AddNativeAnnotationsResult,
  EngineRenderPageOptions,
  EngineRenderedPage,
  EngineBatchRenderOptions,
  WatermarkOptions,
  WatermarkPosition,
  WatermarkResult,
} from './render';

// Parse — native engine extractors
export {
  extractStructuredText,
  extractPlainText,
  searchPdf,
  getMetadataRobust,
  ocrPdf,
  isOcrAvailable,
  OcrUnavailableError,
  makeSearchablePdf,
  makeEditableOcrPdf,
  sampleBackgroundColor,
  ocrWordToPdfPlacement,
  extractOcrBlocks,
  ocrWordToPdfBox,
  pdfBoxToImageRect,
  extractPageBlockGroups,
  extractPageBlockGroupsByPage,
  gigaBlocksToPageBlockGroups,
} from './parse';
export type {
  StructuredChar,
  StructuredLine,
  StructuredBlock,
  StructuredPage,
  ExtractStructuredTextOptions,
  SearchHit,
  SearchOptions,
  SearchResult,
  OcrOptions,
  OcrPageResult,
  OcrResult,
  MakeSearchablePdfOptions,
  MakeSearchablePdfResult,
  MakeEditableOcrPdfOptions,
  MakeEditableOcrPdfResult,
  OcrWordBox,
  PdfPlacementContext,
  PdfWordPlacement,
  OcrBlock,
  ExtractOcrBlocksOptions,
  ExtractOcrBlocksResult,
  PageBlockGroup,
} from './parse';

// Re-export the OCR script identifiers from the engine library so callers
// (API route validation, UI script picker) have a single source of truth for
// the set of writing systems the bundled OCR models cover.
export { ALL_OCR_SCRIPTS } from 'gigapdf-lib-ocr';
export type { OcrScript } from 'gigapdf-lib-ocr';

// Model ops — native paragraph/list formatting bake via the unified model
// (`toModel` → `applyModelOps` → `modelToPdf`). The flat-index ↔ BlockAddr
// bridge: edits keyed by the editor's `source_index` resolve to a positional
// `[section, page, index]` address, then bake structurally into the PDF.
export {
  applyModelOps,
  applyParagraphOps,
  applyTableOps,
  buildSourceIndexAddrMap,
  buildListAddrMap,
  listTablesInModel,
  listPdfTables,
} from './model-ops';
export type {
  ParagraphStyleEdit,
  ListEdit,
  ApplyParagraphOpsResult,
  TableEdit,
  TableInfo,
  TableCellInfo,
  ApplyTableOpsResult,
  GigaBlockAddr,
  GigaDocument,
  GigaListMarker,
  GigaParaPatch,
  GigaRect,
  ModelOp,
} from './model-ops';

// Merge/Split
export { mergePDFs, splitPDF, splitAt } from './merge-split';
export type { MergeOptions, SplitOptions } from './merge-split';

// Forms
export { getFormFields, fillForm, flattenForm } from './forms';
// `flattenForms` (inline Form XObjects → editable page runs) is re-exported
// from the root barrel as `flattenFormXObjects` to avoid colliding with the
// existing `flattenForms` from `./render` (which flattens AcroForm widgets).
// The unaliased `flattenForms` stays available on the `./forms` subpath.
export { flattenForms as flattenFormXObjects } from './forms';
export type { FormFieldInfo, FillResult, FlattenFormsResult } from './forms';

// Encrypt
export { encryptPDF, decryptPDF, getPermissions, setPermissions } from './encrypt';
export type { EncryptOptions, EncryptionAlgorithm, PermissionsResult } from './encrypt';

// Sign — PKCS#7 detached digital signature with a user-provided P12/PFX
export { signPdf, PdfSignInvalidCertificateError } from './sign';
export type { SignPdfOptions, SignPdfResult } from './sign';

// Preview
export { renderPage, renderThumbnail, renderAllThumbnails } from './preview';
export type { RenderOptions, ThumbnailOptions, PreviewFormat } from './preview';

// Convert
export { htmlToPDF, urlToPDFSafe } from './convert';
export type { ConvertOptions, UrlToPDFSafeOptions } from './convert';

// Image / text / RTF → PDF + universal merge (heterogeneous files → one PDF)
export { imageToPdf } from './convert/image-to-pdf';
export { textToPdf, rtfToPdf } from './convert/text-to-pdf';
export { convertMarkdownToPdf, convertCsvToPdf } from './convert/text-model-to-pdf';
// PDF → Markdown / CSV / EPUB / HTML / RTF / plain text (fat-library model path:
// toModel → modelTo*; plain text uses the doc's own toText() serialiser)
export {
  exportPdfToMarkdown,
  exportPdfToCsv,
  exportPdfToEpub,
  exportPdfToHtml,
  exportPdfToRtf,
  exportPdfToText,
  exportPdfToOds,
} from './convert/pdf-to-text-formats';
export { mergeUniversal } from './convert/merge-universal';
export type { UniversalMergeInput } from './convert/merge-universal';

// Utils
export { parsePageRange, type PageRange } from './utils';

// Font cache port — the apps/web layer plugs a Prisma-backed adapter so that
// converted Type1/CFF→TTF bytes survive across requests. The engine itself
// stays free of any DB dependency.
export {
  setFontCacheForHandle,
  type FontCachePort,
  type FontCacheMeta,
  type FontCacheSource,
} from './utils/font-cache-port';

// Google Fonts — résolution PostScript name → famille + téléchargement TTF
// serveur (cache DB via FontCachePort, negative cache mémoire). Utilisé par
// la stratégie 3.5 du text-renderer et exposé à apps/web (route /api/fonts).
export { parsePostScriptName, downloadGoogleFont } from './utils/google-fonts';
export type {
  ParsedPostScriptName,
  GoogleFontQuery,
  DownloadGoogleFontOptions,
  GoogleFontResult,
} from './utils/google-fonts';

// Office ↔ PDF conversion via the WASM conversion engine
export {
  convertOfficeToPdf,
  convertPdfToOffice,
  OfficeConversionError,
  OFFICE_IMPORT_FORMATS,
  PDF_EXPORT_FORMATS,
  isOfficeImportFormat,
  isPdfExportFormat,
} from './convert/office-headless';
export type { OfficeImportFormat, PdfExportFormat } from './convert/office-headless';

// PDF → XLSX (custom table reconstruction)
export { convertPdfToXlsx } from './convert/pdf-to-xlsx';
export type { ConvertPdfToXlsxOptions } from './convert/pdf-to-xlsx';

// Errors
export {
  PDFEngineError,
  PDFParseError,
  PDFCorruptedError,
  PDFEncryptedError,
  PDFInvalidPasswordError,
  PDFPageOutOfRangeError,
  PDFUnsupportedOperationError,
} from './errors';

// Coordinate conversion (web ↔ PDF user space, with rotation handling)
export { webToPdf, pdfToWeb, scaleRect } from './utils/coordinates';
