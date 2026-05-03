/**
 * Collaboration Store - Real-time collaboration state
 * Manages online users, cursors, element locks, and WebSocket connection
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { UUID } from "@giga-pdf/types";

// Idempotent — safe even if selection-store was already imported. Without
// it, Immer 10+ throws error #0 the moment any Map.set/delete runs in a
// produce() callback.
enableMapSet();
import type {
  CollaborationState,
  OnlineUser,
  UserCursor,
  ElementLockInfo,
} from "../types";

// Use a simple type alias to avoid exposing socket.io internal types
type SocketInstance = unknown;

export interface CollaborationStore extends Omit<CollaborationState, 'socket'> {
  socket: SocketInstance;
  // Actions
  setSocket: (socket: SocketInstance) => void;
  setConnected: (connected: boolean) => void;
  setSessionId: (sessionId: UUID | null) => void;
  setCurrentUserId: (userId: UUID | null) => void;
  addUser: (user: OnlineUser) => void;
  removeUser: (userId: UUID) => void;
  updateUser: (userId: UUID, updates: Partial<OnlineUser>) => void;
  updateUserStatus: (
    userId: UUID,
    status: OnlineUser["status"],
    currentPageId?: UUID | null
  ) => void;
  updateCursor: (cursor: UserCursor) => void;
  removeCursor: (userId: UUID) => void;
  lockElement: (elementId: UUID, userId: UUID, userName: string) => void;
  unlockElement: (elementId: UUID) => void;
  isElementLocked: (elementId: UUID) => boolean;
  isElementLockedByOther: (elementId: UUID, currentUserId: UUID) => boolean;
  getElementLock: (elementId: UUID) => ElementLockInfo | undefined;
  clearOldCursors: (maxAgeMs?: number) => void;
  reset: () => void;
}

const initialState: CollaborationState = {
  isConnected: false,
  sessionId: null,
  currentUserId: null,
  onlineUsers: new Map(),
  cursors: new Map(),
  elementLocks: new Map(),
  socket: null,
};

export const useCollaborationStore: UseBoundStore<StoreApi<CollaborationStore>> = create<CollaborationStore>()(
  immer((set, get) => ({
    ...initialState,

    setSocket: (socket) =>
      set(() => ({
        socket,
      })),

    setConnected: (connected) =>
      set((state) => {
        state.isConnected = connected;
        if (!connected) {
          // Clear all collaboration data on disconnect
          state.onlineUsers = new Map();
          state.cursors = new Map();
          state.elementLocks = new Map();
        }
      }),

    setSessionId: (sessionId) =>
      set((state) => {
        state.sessionId = sessionId;
      }),

    setCurrentUserId: (userId) =>
      set((state) => {
        state.currentUserId = userId;
      }),

    addUser: (user) =>
      set((state) => {
        state.onlineUsers.set(user.userId, user);
      }),

    removeUser: (userId) =>
      set((state) => {
        state.onlineUsers.delete(userId);
        state.cursors.delete(userId);

        // Remove any locks held by this user
        const locksToRemove: UUID[] = [];
        state.elementLocks.forEach((lock, elementId) => {
          if (lock.lockedBy === userId) {
            locksToRemove.push(elementId);
          }
        });
        locksToRemove.forEach((elementId) => {
          state.elementLocks.delete(elementId);
        });
      }),

    updateUser: (userId, updates) =>
      set((state) => {
        const user = state.onlineUsers.get(userId);
        if (user) {
          state.onlineUsers.set(userId, { ...user, ...updates });
        }
      }),

    updateUserStatus: (userId, status, currentPageId) =>
      set((state) => {
        const user = state.onlineUsers.get(userId);
        if (user) {
          state.onlineUsers.set(userId, {
            ...user,
            status,
            currentPageId: currentPageId ?? user.currentPageId,
            lastSeenAt: new Date(),
          });
        }
      }),

    updateCursor: (cursor) =>
      set((state) => {
        state.cursors.set(cursor.userId, cursor);
      }),

    removeCursor: (userId) =>
      set((state) => {
        state.cursors.delete(userId);
      }),

    lockElement: (elementId, userId, userName) =>
      set((state) => {
        state.elementLocks.set(elementId, {
          elementId,
          lockedBy: userId,
          lockedByName: userName,
          lockedAt: new Date(),
        });
      }),

    unlockElement: (elementId) =>
      set((state) => {
        state.elementLocks.delete(elementId);
      }),

    isElementLocked: (elementId) => {
      return get().elementLocks.has(elementId);
    },

    isElementLockedByOther: (elementId, currentUserId) => {
      const lock = get().elementLocks.get(elementId);
      return lock !== undefined && lock.lockedBy !== currentUserId;
    },

    getElementLock: (elementId) => {
      return get().elementLocks.get(elementId);
    },

    clearOldCursors: (maxAgeMs = 30000) =>
      set((state) => {
        const now = Date.now();
        const cursorsToRemove: UUID[] = [];

        state.cursors.forEach((cursor, userId) => {
          if (now - cursor.lastUpdate.getTime() > maxAgeMs) {
            cursorsToRemove.push(userId);
          }
        });

        cursorsToRemove.forEach((userId) => {
          state.cursors.delete(userId);
        });
      }),

    reset: () => set(initialState),
  }))
);
