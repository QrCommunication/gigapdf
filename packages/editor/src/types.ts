/**
 * Internal store types for the editor package
 */

import type { UUID, PageObject, Tool } from "@giga-pdf/types";
import type { Socket } from "socket.io-client";

// Document Store Types
export interface DocumentState {
  documentId: UUID | null;
  title: string;
  version: number;
  pages: PageObject[];
  lastSaved: Date | null;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
}

// Canvas Store Types
export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface CanvasState {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  panOffset: { x: number; y: number };
  activeTool: Tool;
  activeSubtype: string | null;
  viewport: ViewportDimensions;
  gridEnabled: boolean;
  snapToGrid: boolean;
  gridSize: number;
  showRulers: boolean;
  currentPageIndex: number;
}

// Selection Store Types
export interface SelectionState {
  selectedElementIds: Set<UUID>;
  selectedPageId: UUID | null;
  isMultiSelect: boolean;
  selectionBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  hoveredElementId: UUID | null;
}

// History Store Types
export interface HistorySnapshot {
  id: string;
  timestamp: Date;
  documentVersion: number;
  pages: PageObject[];
  description: string;
}

export interface HistoryState {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  maxStackSize: number;
  canUndo: boolean;
  canRedo: boolean;
}

// Collaboration Store Types
export interface UserCursor {
  userId: UUID;
  userName: string;
  userColor: string;
  pageId: UUID;
  x: number;
  y: number;
  lastUpdate: Date;
}

export interface OnlineUser {
  userId: UUID;
  userName: string;
  userColor: string;
  email?: string;
  avatarUrl?: string;
  status: "active" | "idle" | "away";
  currentPageId: UUID | null;
  joinedAt: Date;
  lastSeenAt: Date;
}

export interface ElementLockInfo {
  elementId: UUID;
  lockedBy: UUID;
  lockedByName: string;
  lockedAt: Date;
}

export interface CollaborationState {
  isConnected: boolean;
  sessionId: UUID | null;
  currentUserId: UUID | null;
  onlineUsers: Map<UUID, OnlineUser>;
  cursors: Map<UUID, UserCursor>;
  elementLocks: Map<UUID, ElementLockInfo>;
  socket: Socket | null;
}

// UI Store Types
export type PanelType =
  | "layers"
  | "pages"
  | "properties"
  | "comments"
  | "history"
  | "templates";

export type ModalType =
  | "export"
  | "share"
  | "settings"
  | "shortcuts"
  | "upload"
  | null;

export interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  activePanel: PanelType;
  modalOpen: ModalType;
  modalData: Record<string, unknown> | null;
  theme: "light" | "dark" | "system";
  showGrid: boolean;
  showGuides: boolean;
  notifications: Notification[];
  contextMenu: {
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null;
}

export interface Notification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: Date;
  autoClose: boolean;
  duration?: number;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
  items?: ContextMenuItem[];
}

// Middleware Types
export interface SyncConfig {
  enabled: boolean;
  debounceMs: number;
  conflictResolution: "server-wins" | "client-wins" | "merge";
}

export interface PersistenceConfig {
  enabled: boolean;
  debounceMs: number;
  storageKey: string;
}
