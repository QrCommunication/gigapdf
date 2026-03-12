/**
 * @giga-pdf/api
 * API client and TanStack Query hooks for GigaPDF
 */

// Configuration
export { getApiConfig, setApiConfig, resetApiConfig } from './config';
export type { ApiConfig } from './config';

// Client
export {
  apiClient,
  setTokenStorage,
  setOnUnauthorized,
  getTokenStorage,
  ApiError,
  defaultTokenStorage,
} from './client';
export type { TokenStorage } from './client';

// Services
export {
  authService,
  documentService,
  pageService,
  elementService,
  uploadService,
  exportService,
  ocrService,
  jobService,
  storageService,
  billingService,
  pdfService,
} from './services';
export type {
  OpenPdfOptions,
  OpenPdfResult,
  SavePdfOptions,
  MergePdfOptions,
  SplitPdfOptions,
  SplitPdfResult,
  SplitPart,
  PreviewOptions,
  AllThumbnailsResult,
  ThumbnailData,
  EncryptOptions,
  PermissionsResult,
  FormFieldsResult,
  ElementOperationOptions,
  ConvertOptions,
  MetadataResult,
  FlattenOptions,
  ApplyElementsOperation,
} from './services';

// Hooks
export {
  // Auth hooks
  useCurrentUser,
  useLogin,
  useRegister,
  useLogout,
  useUpdateProfile,
  useRequestPasswordReset,
  useResetPassword,
  useVerifyEmail,
  useResendVerificationEmail,
  authKeys,

  // Document hooks
  useDocuments,
  useInfiniteDocuments,
  useDocument,
  useCreateDocument,
  useUpdateDocument,
  useDeleteDocument,
  useDuplicateDocument,
  useShareDocument,
  useRemoveCollaborator,
  useUpdateCollaboratorPermission,
  useDocumentHistory,
  useRestoreDocumentVersion,
  documentKeys,

  // Page hooks — pages are identified by page_number (integer), not a UUID
  usePage,
  useCreatePage,
  useDeletePage,
  useDuplicatePage,
  useReorderPages,
  useRotatePage,
  useResizePage,
  useExtractPages,
  useMovePage,
  usePagePreview,
  usePageImage,
  pageKeys,

  // Element hooks
  useElements,
  useElement,
  useCreateElement,
  useUpdateElement,
  useBulkUpdateElements,
  useDeleteElement,
  useBulkDeleteElements,
  useDuplicateElement,
  useMoveElement,
  useUpdateElementZIndex,
  useBringElementToFront,
  useSendElementToBack,
  useGroupElements,
  useUngroupElements,
  elementKeys,

  // Upload hooks
  useUploadDirect,
  useUnlockDocument,
  useGetPresignedUrl,
  useUploadToPresignedUrl,
  useCompleteUpload,
  useCancelUpload,
  useUploadStatus,
  useFileUpload,
  uploadKeys,

  // Export hooks
  useCreateExport,
  useExportStatus,
  useDownloadExport,
  useCancelExport,
  useExports,
  useExportDirect,
  useExportDownloadUrl,
  useExportAndDownload,
  exportKeys,

  // OCR hooks
  useStartOcr,
  useOcrStatus,
  useOcrLanguages,
  useOcrResults,
  useCancelOcr,
  useOcrJobs,
  useApplyOcrResults,
  ocrKeys,

  // Job hooks
  useJob,
  useJobs,
  useCancelJob,
  useRetryJob,
  useDeleteJob,
  useJobResult,
  useClearCompletedJobs,
  jobKeys,

  // Storage hooks
  useStorageDocuments,
  useCreateStorageDocument,
  useLoadDocument,
  useUpdateStorageDocument,
  useDeleteStorageDocument,
  useMoveDocument,
  useDocumentVersions,
  useCreateVersion,
  useFolders,
  useCreateFolder,
  useDeleteFolder,
  useMoveFolder,
  useFolderStats,
  useStorageQuota,
  useEffectiveQuota,
  useQuotaPlans,
  storageKeys,

  // Billing hooks
  useSubscription,
  usePlans,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useUpdateSubscription,
  useCancelSubscription,
  useReactivateSubscription,
  useInvoices,
  useInvoice,
  useDownloadInvoice,
  usePaymentMethods,
  useAddPaymentMethod,
  useRemovePaymentMethod,
  useSetDefaultPaymentMethod,
  useUsageSummary,
  billingKeys,

  // PDF engine hooks
  useOpenPdf,
  useSavePdf,
  useMergePdfs,
  useSplitPdf,
  usePreviewPage,
  usePreviewAllThumbnails,
  useEncryptPdf,
  useDecryptPdf,
  useGetPermissions,
  useSetPermissions,
  useGetFormFields,
  useFillFormFields,
  useAddFormField,
  usePdfTextOperation,
  usePdfImageOperation,
  usePdfShapeOperation,
  usePdfAnnotationOperation,
  usePdfPageOperation,
  useGetPdfMetadata,
  useSetPdfMetadata,
  useFlattenPdf,
  useConvertToPdf,
  useApplyElements,
  downloadBlob,
  pdfKeys,
} from './hooks';

// WebSocket
export {
  socketClient,
  useSocket,
  useSocketEvent,
  useDocumentCollaboration,
  useDocumentUpdates,
  usePageUpdates,
  useElementUpdates,
  useJobStatus,
} from './websocket';
export type { SocketEvent, SocketEventData } from './websocket';

// Providers
export { QueryProvider, SocketProvider, useSocketContext } from './providers';
