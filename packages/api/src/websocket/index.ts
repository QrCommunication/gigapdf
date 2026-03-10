/**
 * Export WebSocket client and hooks
 */
export { socketClient } from './client';
export type { SocketEvent, SocketEventData } from './client';

export {
  useSocket,
  useSocketEvent,
  useDocumentCollaboration,
  useDocumentUpdates,
  usePageUpdates,
  useElementUpdates,
  useJobStatus,
} from './hooks';
