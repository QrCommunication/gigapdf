/**
 * WebSocket Event Types
 * Matches FastAPI Socket.IO event schemas
 */

import type { UUID, ISODateTime } from "../models/common";
import type { Element } from "../models/elements";
import type { CursorPosition, UserPresence } from "../models/collaboration";

// ============================================================================
// Connection Events
// ============================================================================

export interface SocketAuthPayload {
  token: string;
  documentId?: UUID;
}

export interface SocketAuthResponse {
  success: boolean;
  userId?: UUID;
  sessionId?: UUID;
  error?: string;
}

// ============================================================================
// Document Events
// ============================================================================

export interface JoinDocumentPayload {
  documentId: UUID;
}

export interface JoinDocumentResponse {
  success: boolean;
  documentId: UUID;
  collaborators: UserPresence[];
  version: number;
}

export interface LeaveDocumentPayload {
  documentId: UUID;
}

// ============================================================================
// Cursor Events
// ============================================================================

export interface CursorMovePayload {
  documentId: UUID;
  pageId: UUID;
  position: CursorPosition;
}

export interface CursorMoveEvent {
  userId: UUID;
  userName: string;
  userColor: string;
  pageId: UUID;
  position: CursorPosition;
  timestamp: ISODateTime;
}

// ============================================================================
// Selection Events
// ============================================================================

export interface SelectionChangePayload {
  documentId: UUID;
  pageId: UUID;
  elementIds: UUID[];
}

export interface SelectionChangeEvent {
  userId: UUID;
  userName: string;
  userColor: string;
  pageId: UUID;
  elementIds: UUID[];
  timestamp: ISODateTime;
}

// ============================================================================
// Element Events
// ============================================================================

export interface ElementCreatePayload {
  documentId: UUID;
  pageId: UUID;
  element: Omit<Element, "elementId">;
  tempId?: string;
}

export interface ElementCreateEvent {
  userId: UUID;
  pageId: UUID;
  element: Element;
  tempId?: string;
  version: number;
}

export interface ElementUpdatePayload {
  documentId: UUID;
  pageId: UUID;
  elementId: UUID;
  changes: Partial<Element>;
  version: number;
}

export interface ElementUpdateEvent {
  userId: UUID;
  pageId: UUID;
  elementId: UUID;
  changes: Partial<Element>;
  version: number;
  timestamp: ISODateTime;
}

export interface ElementDeletePayload {
  documentId: UUID;
  pageId: UUID;
  elementId: UUID;
  version: number;
}

export interface ElementDeleteEvent {
  userId: UUID;
  pageId: UUID;
  elementId: UUID;
  version: number;
  timestamp: ISODateTime;
}

export interface ElementLockPayload {
  documentId: UUID;
  pageId: UUID;
  elementId: UUID;
  lock: boolean;
}

export interface ElementLockEvent {
  userId: UUID;
  userName: string;
  pageId: UUID;
  elementId: UUID;
  locked: boolean;
  lockedBy?: UUID;
  timestamp: ISODateTime;
}

// ============================================================================
// Batch Operations
// ============================================================================

export interface BatchOperationPayload {
  documentId: UUID;
  operations: OperationItem[];
  version: number;
}

export interface OperationItem {
  type: "create" | "update" | "delete";
  pageId: UUID;
  elementId?: UUID;
  element?: Omit<Element, "elementId">;
  changes?: Partial<Element>;
  tempId?: string;
}

export interface BatchOperationEvent {
  userId: UUID;
  operations: OperationResult[];
  version: number;
  timestamp: ISODateTime;
}

export interface OperationResult {
  type: "create" | "update" | "delete";
  pageId: UUID;
  elementId: UUID;
  tempId?: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Presence Events
// ============================================================================

export interface UserJoinedEvent {
  user: UserPresence;
  documentId: UUID;
  timestamp: ISODateTime;
}

export interface UserLeftEvent {
  userId: UUID;
  documentId: UUID;
  timestamp: ISODateTime;
}

export interface PresenceUpdatePayload {
  documentId: UUID;
  status?: "active" | "idle" | "away";
  currentPage?: UUID;
}

export interface PresenceUpdateEvent {
  userId: UUID;
  status: "active" | "idle" | "away";
  currentPage?: UUID;
  timestamp: ISODateTime;
}

// ============================================================================
// Page Events
// ============================================================================

export interface PageAddedEvent {
  userId: UUID;
  documentId: UUID;
  pageId: UUID;
  pageNumber: number;
  version: number;
  timestamp: ISODateTime;
}

export interface PageDeletedEvent {
  userId: UUID;
  documentId: UUID;
  pageId: UUID;
  pageNumber: number;
  version: number;
  timestamp: ISODateTime;
}

export interface PageReorderedEvent {
  userId: UUID;
  documentId: UUID;
  pageOrder: UUID[];
  version: number;
  timestamp: ISODateTime;
}

// ============================================================================
// Sync Events
// ============================================================================

export interface SyncRequestPayload {
  documentId: UUID;
  fromVersion: number;
}

export interface SyncResponseEvent {
  documentId: UUID;
  currentVersion: number;
  operations: SyncOperation[];
  fullSyncRequired: boolean;
}

export interface SyncOperation {
  version: number;
  type: "create" | "update" | "delete";
  pageId: UUID;
  elementId?: UUID;
  data?: unknown;
  timestamp: ISODateTime;
  userId: UUID;
}

export interface ConflictEvent {
  documentId: UUID;
  pageId: UUID;
  elementId: UUID;
  clientVersion: number;
  serverVersion: number;
  serverData: Partial<Element>;
  resolution: "server_wins" | "client_wins" | "merge";
}

// ============================================================================
// Comment Events
// ============================================================================

export interface CommentAddPayload {
  documentId: UUID;
  pageId: UUID;
  elementId?: UUID;
  position?: { x: number; y: number };
  content: string;
  parentId?: UUID;
}

export interface CommentAddEvent {
  commentId: UUID;
  userId: UUID;
  userName: string;
  userAvatar?: string;
  pageId: UUID;
  elementId?: UUID;
  position?: { x: number; y: number };
  content: string;
  parentId?: UUID;
  createdAt: ISODateTime;
}

export interface CommentUpdatePayload {
  documentId: UUID;
  commentId: UUID;
  content: string;
}

export interface CommentUpdateEvent {
  commentId: UUID;
  userId: UUID;
  content: string;
  updatedAt: ISODateTime;
}

export interface CommentDeletePayload {
  documentId: UUID;
  commentId: UUID;
}

export interface CommentDeleteEvent {
  commentId: UUID;
  userId: UUID;
  deletedAt: ISODateTime;
}

export interface CommentResolvePayload {
  documentId: UUID;
  commentId: UUID;
  resolved: boolean;
}

export interface CommentResolveEvent {
  commentId: UUID;
  userId: UUID;
  resolved: boolean;
  resolvedAt?: ISODateTime;
}

// ============================================================================
// Notification Events
// ============================================================================

export interface NotificationEvent {
  type: "info" | "warning" | "error";
  title: string;
  message: string;
  documentId?: UUID;
  timestamp: ISODateTime;
}

export interface DocumentSavedEvent {
  documentId: UUID;
  version: number;
  savedAt: ISODateTime;
  autoSave: boolean;
}

export interface DocumentLockedEvent {
  documentId: UUID;
  lockedBy: UUID;
  lockedByName: string;
  reason?: string;
  timestamp: ISODateTime;
}

export interface DocumentUnlockedEvent {
  documentId: UUID;
  unlockedBy: UUID;
  timestamp: ISODateTime;
}

// ============================================================================
// Error Events
// ============================================================================

export interface SocketErrorEvent {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  timestamp: ISODateTime;
}

// ============================================================================
// Event Type Map
// ============================================================================

export interface ServerToClientEvents {
  // Connection
  "auth:response": (data: SocketAuthResponse) => void;

  // Document
  "document:joined": (data: JoinDocumentResponse) => void;
  "document:saved": (data: DocumentSavedEvent) => void;
  "document:locked": (data: DocumentLockedEvent) => void;
  "document:unlocked": (data: DocumentUnlockedEvent) => void;

  // Presence
  "user:joined": (data: UserJoinedEvent) => void;
  "user:left": (data: UserLeftEvent) => void;
  "presence:update": (data: PresenceUpdateEvent) => void;

  // Cursor & Selection
  "cursor:move": (data: CursorMoveEvent) => void;
  "selection:change": (data: SelectionChangeEvent) => void;

  // Elements
  "element:created": (data: ElementCreateEvent) => void;
  "element:updated": (data: ElementUpdateEvent) => void;
  "element:deleted": (data: ElementDeleteEvent) => void;
  "element:locked": (data: ElementLockEvent) => void;
  "batch:applied": (data: BatchOperationEvent) => void;

  // Pages
  "page:added": (data: PageAddedEvent) => void;
  "page:deleted": (data: PageDeletedEvent) => void;
  "page:reordered": (data: PageReorderedEvent) => void;

  // Sync
  "sync:response": (data: SyncResponseEvent) => void;
  "sync:conflict": (data: ConflictEvent) => void;

  // Comments
  "comment:added": (data: CommentAddEvent) => void;
  "comment:updated": (data: CommentUpdateEvent) => void;
  "comment:deleted": (data: CommentDeleteEvent) => void;
  "comment:resolved": (data: CommentResolveEvent) => void;

  // Notifications
  "notification": (data: NotificationEvent) => void;
  "error": (data: SocketErrorEvent) => void;
}

export interface ClientToServerEvents {
  // Connection
  "auth": (data: SocketAuthPayload) => void;

  // Document
  "document:join": (data: JoinDocumentPayload) => void;
  "document:leave": (data: LeaveDocumentPayload) => void;

  // Presence
  "presence:update": (data: PresenceUpdatePayload) => void;

  // Cursor & Selection
  "cursor:move": (data: CursorMovePayload) => void;
  "selection:change": (data: SelectionChangePayload) => void;

  // Elements
  "element:create": (data: ElementCreatePayload) => void;
  "element:update": (data: ElementUpdatePayload) => void;
  "element:delete": (data: ElementDeletePayload) => void;
  "element:lock": (data: ElementLockPayload) => void;
  "batch:apply": (data: BatchOperationPayload) => void;

  // Sync
  "sync:request": (data: SyncRequestPayload) => void;

  // Comments
  "comment:add": (data: CommentAddPayload) => void;
  "comment:update": (data: CommentUpdatePayload) => void;
  "comment:delete": (data: CommentDeletePayload) => void;
  "comment:resolve": (data: CommentResolvePayload) => void;
}
