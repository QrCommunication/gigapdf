export { addText } from './text-renderer';
export { addImage } from './image-renderer';
export { addShape } from './shape-renderer';
export { addAnnotation } from './annotation-renderer';
export { addFormField, updateFormFieldValue } from './form-renderer';
export { flattenAnnotations, flattenForms } from './flatten';
export type { FlattenAnnotationsResult } from './flatten';
export { applyRedactions } from './mupdf-redact';
export type { RedactionTarget, ApplyRedactionsResult } from './mupdf-redact';
export { applyOperations } from './apply-operations';
export type {
  ElementOperation,
  ApplyOperationsOptions,
  ApplyOperationsResult,
} from './apply-operations';
export { optimizeAndSave } from './optimize-save';
export type { OptimizeSaveOptions, OptimizeSaveResult } from './optimize-save';
export { convertToPdfA, PdfAConversionError } from './pdfa-convert';
export type { PdfAVariant, PdfAConversionResult } from './pdfa-convert';
export { addNativeAnnotations } from './native-annotations';
export type {
  NativeAnnotationType,
  NativeAnnotationSpec,
  AddNativeAnnotationsResult,
} from './native-annotations';
export {
  renderPages as mupdfRenderPages,
  renderPage as mupdfRenderPage,
} from './mupdf-render';
export type {
  RenderPageOptions as MupdfRenderPageOptions,
  RenderedPage as MupdfRenderedPage,
  BatchRenderOptions as MupdfBatchRenderOptions,
} from './mupdf-render';
export { addWatermark } from './watermark';
export type {
  WatermarkOptions,
  WatermarkPosition,
  WatermarkResult,
} from './watermark';
