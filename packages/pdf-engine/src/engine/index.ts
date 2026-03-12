export {
  openDocument,
  saveDocument,
  closeDocument,
  getMetadata,
  setMetadata,
  getPageDimensions,
  markDirty,
} from './document-handle';
export type {
  PDFDocumentHandle,
  OpenDocumentOptions,
  SaveDocumentOptions,
  PageDimensions,
} from './document-handle';
export { addPage, deletePage, movePage, rotatePage, copyPage, resizePage } from './page-ops';
