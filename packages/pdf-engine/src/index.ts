// Engine
export {
  openDocument,
  saveDocument,
  closeDocument,
  getMetadata,
  setMetadata,
  getPageDimensions,
  addPage,
  deletePage,
  movePage,
  rotatePage,
  copyPage,
  resizePage,
} from './engine';
export type {
  PDFDocumentHandle,
  OpenDocumentOptions,
  SaveDocumentOptions,
  PageDimensions,
} from './engine';

// Parse
export {
  parseDocument,
  parsePage,
  parseMetadata,
  parseBookmarks,
} from './parse';
export type { ParseOptions, ParsePageOptions } from './parse';

// Render
export {
  addText,
  updateText,
  addImage,
  updateImage,
  addShape,
  addAnnotation,
  addFormField,
  updateFormFieldValue,
  deleteElementArea,
  flattenAnnotations,
  flattenForms,
} from './render';

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
export {
  renderPage,
  renderThumbnail,
  renderAllThumbnails,
  extractImage,
  setCanvasPoolSize,
  destroyCanvasPool,
} from './preview';
export type { RenderOptions, ThumbnailOptions, PreviewFormat } from './preview';

// Convert
export {
  htmlToPDF,
  urlToPDF,
  urlToPDFSafe,
  setPlaywrightPoolSize,
  destroyPlaywrightPool,
} from './convert';
export type { ConvertOptions, UrlToPDFSafeOptions } from './convert';

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

// Constants
export {
  POINTS_PER_INCH,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_PAGE_HEIGHT,
  A4_PAGE_WIDTH,
  A4_PAGE_HEIGHT,
  MAX_PREVIEW_DPI,
  DEFAULT_PREVIEW_DPI,
} from './constants';

// Utils
export { hexToRgb, rgbToHex, normalizeColor } from './utils';
export { webToPdf, pdfToWeb, scaleRect } from './utils';
export { normalizeFontName, resolveStandardFont, isStandardFont, mapPdfFontToStandard } from './utils';
export { parsePageRange, type PageRange } from './utils';
export { engineLogger } from './utils';

// Text renderer utilities (cache management)
export { clearFontCache } from './render/text-renderer';
