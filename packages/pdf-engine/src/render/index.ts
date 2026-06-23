export { addText } from './text-renderer';
export { addImage } from './image-renderer';
export { addShape } from './shape-renderer';
export { addAnnotation } from './annotation-renderer';
export { addFormField, updateFormFieldValue } from './form-renderer';
export { flattenAnnotations, flattenForms } from './flatten';
export type { FlattenAnnotationsResult } from './flatten';
export { applyRedactions } from './engine-redact';
export type { RedactionTarget, ApplyRedactionsResult } from './engine-redact';
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
export { applyOcgOperations } from './ocg-layers';
export type {
  OcgLayerOperation,
  ApplyOcgOperationsResult,
} from './ocg-layers';
export {
  renderPages as engineRenderPages,
  renderPage as engineRenderPage,
} from './engine-render';
export type {
  RenderPageOptions as EngineRenderPageOptions,
  RenderedPage as EngineRenderedPage,
  BatchRenderOptions as EngineBatchRenderOptions,
} from './engine-render';
export { addWatermark } from './watermark';
export type {
  WatermarkOptions,
  WatermarkPosition,
  WatermarkResult,
} from './watermark';
export { addImageWatermark } from './image-watermark';
export type {
  ImageWatermarkOptions,
  ImageWatermarkAnchor,
  ImageWatermarkResult,
} from './image-watermark';
