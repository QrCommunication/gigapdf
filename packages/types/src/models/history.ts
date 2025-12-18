/**
 * History models for undo/redo functionality.
 */

import type { UUID } from "./common";

export interface HistoryEntry {
  index: number;
  action: string;
  timestamp: string;
  canUndo: boolean;
  canRedo: boolean;
  affectedElements: UUID[];
  affectedPages: number[];
}

export interface HistoryState {
  currentIndex: number;
  history: HistoryEntry[];
  maxHistorySize: number;
  canUndo: boolean;
  canRedo: boolean;
}
