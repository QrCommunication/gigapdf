/**
 * Collaboration models for real-time multi-user editing.
 */

import type { UUID } from "./common";

export interface CursorPosition {
  x: number;
  y: number;
}

export interface UserPresence {
  userId: UUID;
  userName: string;
  userColor: string;
  status: "active" | "idle" | "away";
  currentPage?: UUID;
  cursor?: CursorPosition;
  selection?: UUID[];
  lastSeen: string;
}

export interface CollaboratorInfo {
  userId: string;
  userName: string;
  userColor: string;
  cursorPage: number | null;
  cursorX: number | null;
  cursorY: number | null;
}

export interface ElementLock {
  elementId: UUID;
  lockedByUserId: string;
  lockedByUserName: string;
  expiresAt: string;
}

export interface CollaborationSession {
  sessionId: UUID;
  documentId: UUID;
  userId: string;
  userName: string;
  userColor: string;
  isActive: boolean;
  joinedAt: string;
  lastSeenAt: string;
}

// User colors palette (12 colors, cycles after)
export const USER_COLORS = [
  "#3B82F6", // Blue
  "#10B981", // Green
  "#F59E0B", // Amber
  "#EF4444", // Red
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#F97316", // Orange
  "#14B8A6", // Teal
  "#6366F1", // Indigo
  "#84CC16", // Lime
  "#F43F5E", // Rose
] as const;
