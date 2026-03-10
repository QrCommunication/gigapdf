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

  // Page hooks
  usePages,
  usePage,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  useDuplicatePage,
  useReorderPages,
  useMovePage,
  usePageThumbnail,
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
  useUpdateElementZIndex,
  useBringElementToFront,
  useSendElementToBack,
  useGroupElements,
  useUngroupElements,
  elementKeys,

  // Upload hooks
  useGetPresignedUrl,
  useUploadToPresignedUrl,
  useCompleteUpload,
  useUploadDirect,
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
  useStorageInfo,
  useStorageQuota,
  useStorageUsage,
  useCleanupTemp,
  useLargestFiles,
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
