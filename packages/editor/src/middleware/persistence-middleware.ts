/**
 * Persistence Middleware - Auto-save document state with debounce
 */

import type { PersistenceConfig } from "../types";
import { useDocumentStore } from "../stores/document-store";
import { useHistoryStore } from "../stores/history-store";

let saveTimeout: NodeJS.Timeout | null = null;
let lastSaveTime: number = 0;

const defaultConfig: PersistenceConfig = {
  enabled: true,
  debounceMs: 2000,
  storageKey: "giga-pdf-autosave",
};

/**
 * Save callback type
 */
export type SaveCallback = (data: {
  documentId: string;
  title: string;
  pages: any[];
  version: number;
}) => Promise<void>;

/**
 * Initialize persistence middleware
 */
export function initPersistenceMiddleware(
  saveCallback: SaveCallback,
  config: Partial<PersistenceConfig> = {}
): () => void {
  const finalConfig = { ...defaultConfig, ...config };

  if (!finalConfig.enabled) {
    return () => {};
  }

  // Subscribe to document store changes
  const unsubscribe = useDocumentStore.subscribe((state) => {
    if (!finalConfig.enabled) {
      return;
    }

    // Only auto-save if document is dirty and has a document ID
    if (!state.documentId || !state.isDirty) {
      return;
    }

    // Debounce save
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(async () => {
      await performSave(state, saveCallback);
      saveTimeout = null;
    }, finalConfig.debounceMs);
  });

  // Setup periodic auto-save (every 5 minutes)
  const periodicSaveInterval = setInterval(() => {
    const state = useDocumentStore.getState();

    if (
      state.documentId &&
      state.isDirty &&
      Date.now() - lastSaveTime > 300000 // 5 minutes
    ) {
      performSave(state, saveCallback);
    }
  }, 60000); // Check every minute

  return () => {
    unsubscribe();
    clearInterval(periodicSaveInterval);
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
  };
}

/**
 * Perform the save operation
 */
async function performSave(
  state: any,
  saveCallback: SaveCallback
): Promise<void> {
  try {
    await saveCallback({
      documentId: state.documentId,
      title: state.title,
      pages: state.pages,
      version: state.version,
    });

    // Mark as saved
    useDocumentStore.getState().markSaved();
    lastSaveTime = Date.now();

    console.log("Document auto-saved successfully");
  } catch (error) {
    console.error("Failed to auto-save document:", error);

    // Set error state
    useDocumentStore.getState().setError(
      error instanceof Error ? error.message : "Failed to save document"
    );
  }
}

/**
 * Save document to local storage (fallback)
 */
export function saveToLocalStorage(key?: string): void {
  const config = { ...defaultConfig };
  const storageKey = key || config.storageKey;

  const state = useDocumentStore.getState();

  if (!state.documentId) {
    return;
  }

  const data = {
    documentId: state.documentId,
    title: state.title,
    pages: state.pages,
    version: state.version,
    savedAt: new Date().toISOString(),
  };

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(storageKey, JSON.stringify(data));
      console.log("Document saved to local storage");
    }
  } catch (error) {
    console.error("Failed to save to local storage:", error);
  }
}

/**
 * Load document from local storage
 */
export function loadFromLocalStorage(key?: string): boolean {
  const config = { ...defaultConfig };
  const storageKey = key || config.storageKey;

  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const data = window.localStorage.getItem(storageKey);

    if (!data) {
      return false;
    }

    const parsed = JSON.parse(data);

    const documentStore = useDocumentStore.getState();
    documentStore.setDocument(
      parsed.documentId,
      parsed.title,
      parsed.pages
    );
    documentStore.setVersion(parsed.version);

    console.log("Document loaded from local storage");
    return true;
  } catch (error) {
    console.error("Failed to load from local storage:", error);
    return false;
  }
}

/**
 * Clear local storage
 */
export function clearLocalStorage(key?: string): void {
  const config = { ...defaultConfig };
  const storageKey = key || config.storageKey;

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(storageKey);
      console.log("Local storage cleared");
    }
  } catch (error) {
    console.error("Failed to clear local storage:", error);
  }
}

/**
 * Check if local storage has saved data
 */
export function hasLocalStorageData(key?: string): boolean {
  const config = { ...defaultConfig };
  const storageKey = key || config.storageKey;

  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }
    const data = window.localStorage.getItem(storageKey);
    return data !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Manually trigger a save
 */
export async function manualSave(saveCallback: SaveCallback): Promise<void> {
  const state = useDocumentStore.getState();

  if (!state.documentId) {
    throw new Error("No document to save");
  }

  await performSave(state, saveCallback);
}

/**
 * Create a snapshot before save
 */
export function createSaveSnapshot(description: string = "Manual save"): void {
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    description
  );
}

/**
 * Export document state as JSON
 */
export function exportDocumentState(): string {
  const state = useDocumentStore.getState();

  const exportData = {
    documentId: state.documentId,
    title: state.title,
    pages: state.pages,
    version: state.version,
    exportedAt: new Date().toISOString(),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Import document state from JSON
 */
export function importDocumentState(json: string): boolean {
  try {
    const data = JSON.parse(json);

    const documentStore = useDocumentStore.getState();
    documentStore.setDocument(
      data.documentId,
      data.title,
      data.pages
    );
    documentStore.setVersion(data.version || 0);

    return true;
  } catch (error) {
    console.error("Failed to import document state:", error);
    return false;
  }
}
