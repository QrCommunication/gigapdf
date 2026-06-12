// Engine
export {
  openDocument,
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
export { extractFormFields } from './parse/form-extractor';
export type { FormField, FormFieldType } from './parse/form-extractor';

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
  mupdfRenderPage,
  mupdfRenderPages,
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
  MupdfRenderPageOptions,
  MupdfRenderedPage,
  MupdfBatchRenderOptions,
  WatermarkOptions,
  WatermarkPosition,
  WatermarkResult,
} from './render';

// Parse — MuPDF-powered extractors
export {
  extractStructuredText,
  extractPlainText,
  searchPdf,
  getMetadataRobust,
  ocrPdf,
  isTesseractAvailable,
  TesseractNotInstalledError,
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
} from './parse';

// Merge/Split
export { mergePDFs, splitPDF, splitAt } from './merge-split';
export type { MergeOptions, SplitOptions } from './merge-split';

// Forms
export { getFormFields, fillForm, flattenForm } from './forms';
export type { FormFieldInfo, FillResult } from './forms';

// Encrypt
export { encryptPDF, decryptPDF, getPermissions, setPermissions } from './encrypt';
export type { EncryptOptions, EncryptionAlgorithm, PermissionsResult } from './encrypt';

// Preview
export { renderPage, renderThumbnail, renderAllThumbnails } from './preview';
export type { RenderOptions, ThumbnailOptions, PreviewFormat } from './preview';

// Convert
export { htmlToPDF, urlToPDFSafe } from './convert';
export type { ConvertOptions, UrlToPDFSafeOptions } from './convert';
export {
  convertPdfToImages,
  PopplerUnavailableError,
  PopplerConversionError,
} from './convert/pdf-to-image';
export type { ConvertPdfToImageOptions } from './convert/pdf-to-image';

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

// Office ↔ PDF conversion via LibreOffice headless
export {
  convertOfficeToPdf,
  convertPdfToOffice,
  LibreOfficeUnavailableError,
  LibreOfficeConversionError,
} from './convert/office-headless';

// PDF → XLSX (custom extraction, libreoffice ne supporte pas)
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
