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
