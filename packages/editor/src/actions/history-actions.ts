/**
 * History Actions - Undo, redo, save snapshots
 */

import { useHistoryStore } from "../stores/history-store";
import { useDocumentStore } from "../stores/document-store";

/**
 * Undo the last action
 */
export function undo(): boolean {
  const historyStore = useHistoryStore.getState();
  const documentStore = useDocumentStore.getState();

  if (!historyStore.canUndo) {
    return false;
  }

  const snapshot = historyStore.undo();
  if (!snapshot) {
    return false;
  }

  // Restore the document state from the snapshot
  documentStore.setPages(snapshot.pages);
  documentStore.setVersion(snapshot.documentVersion);

  return true;
}

/**
 * Redo the last undone action
 */
export function redo(): boolean {
  const historyStore = useHistoryStore.getState();
  const documentStore = useDocumentStore.getState();

  if (!historyStore.canRedo) {
    return false;
  }

  const snapshot = historyStore.redo();
  if (!snapshot) {
    return false;
  }

  // Restore the document state from the snapshot
  documentStore.setPages(snapshot.pages);
  documentStore.setVersion(snapshot.documentVersion);

  return true;
}

/**
 * Save a snapshot of the current state
 */
export function saveSnapshot(description: string): void {
  const historyStore = useHistoryStore.getState();
  const documentStore = useDocumentStore.getState();

  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    description
  );
}

/**
 * Clear all history
 */
export function clearHistory(): void {
  const historyStore = useHistoryStore.getState();
  historyStore.clear();
}

/**
 * Get undo description
 */
export function getUndoDescription(): string | null {
  const historyStore = useHistoryStore.getState();
  return historyStore.getUndoDescription();
}

/**
 * Get redo description
 */
export function getRedoDescription(): string | null {
  const historyStore = useHistoryStore.getState();
  return historyStore.getRedoDescription();
}

/**
 * Check if undo is available
 */
export function canUndo(): boolean {
  const historyStore = useHistoryStore.getState();
  return historyStore.canUndo;
}

/**
 * Check if redo is available
 */
export function canRedo(): boolean {
  const historyStore = useHistoryStore.getState();
  return historyStore.canRedo;
}
