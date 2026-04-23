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
export { renderPage, renderThumbnail, renderAllThumbnails } from './preview';
export type { RenderOptions, ThumbnailOptions, PreviewFormat } from './preview';

// Convert
export { htmlToPDF, urlToPDFSafe } from './convert';
export type { ConvertOptions, UrlToPDFSafeOptions } from './convert';

// Utils
export { parsePageRange, type PageRange } from './utils';

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
