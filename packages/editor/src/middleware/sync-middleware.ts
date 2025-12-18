/**
 * Sync Middleware - Sync state changes with WebSocket
 */

import type { Socket } from "socket.io-client";
import type { UUID, Element } from "@giga-pdf/types";
import type { SyncConfig } from "../types";
import { useCollaborationStore } from "../stores/collaboration-store";
import { useDocumentStore } from "../stores/document-store";

let syncTimeout: NodeJS.Timeout | null = null;
let pendingChanges: Map<UUID, Partial<Element>> = new Map();

const defaultConfig: SyncConfig = {
  enabled: true,
  debounceMs: 300,
  conflictResolution: "server-wins",
};

/**
 * Initialize sync middleware
 */
export function initSyncMiddleware(
  socket: Socket | null,
  config: Partial<SyncConfig> = {}
): () => void {
  const finalConfig = { ...defaultConfig, ...config };

  if (!socket || !finalConfig.enabled) {
    return () => {};
  }

  const collaborationStore = useCollaborationStore.getState();
  collaborationStore.setSocket(socket);

  // Subscribe to document store changes
  const unsubscribe = useDocumentStore.subscribe((state, prevState) => {
    if (!finalConfig.enabled || !socket.connected) {
      return;
    }

    // Detect page changes
    if (state.pages !== prevState.pages) {
      handlePagesChanged(socket, state.pages, prevState.pages, finalConfig);
    }

    // Detect version changes
    if (state.version !== prevState.version) {
      handleVersionChanged(socket, state.version);
    }
  });

  // Setup WebSocket event listeners
  setupSocketListeners(socket);

  return () => {
    unsubscribe();
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
  };
}

/**
 * Handle page changes and sync to server
 */
function handlePagesChanged(
  socket: Socket,
  currentPages: any[],
  previousPages: any[],
  config: SyncConfig
): void {
  // Debounce sync to avoid too many updates
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(() => {
    // Detect specific changes (elements added/updated/deleted)
    const changes = detectChanges(currentPages, previousPages);

    if (changes.length > 0) {
      emitChanges(socket, changes);
    }

    syncTimeout = null;
  }, config.debounceMs);
}

/**
 * Detect changes between current and previous page states
 */
function detectChanges(currentPages: any[], previousPages: any[]): any[] {
  const changes: any[] = [];

  currentPages.forEach((currentPage, pageIndex) => {
    const previousPage = previousPages[pageIndex];

    if (!previousPage) {
      // New page added
      changes.push({
        type: "page:added",
        pageId: currentPage.pageId,
        pageNumber: currentPage.pageNumber,
      });
      return;
    }

    // Check for element changes
    const currentElements = currentPage.elements || [];
    const previousElements = previousPage.elements || [];

    // Detect new or updated elements
    currentElements.forEach((currentElement: Element) => {
      const previousElement = previousElements.find(
        (e: Element) => e.elementId === currentElement.elementId
      );

      if (!previousElement) {
        // New element
        changes.push({
          type: "element:created",
          pageId: currentPage.pageId,
          element: currentElement,
        });
      } else if (
        JSON.stringify(currentElement) !== JSON.stringify(previousElement)
      ) {
        // Updated element
        changes.push({
          type: "element:updated",
          pageId: currentPage.pageId,
          elementId: currentElement.elementId,
          changes: getElementDiff(previousElement, currentElement),
        });
      }
    });

    // Detect deleted elements
    previousElements.forEach((previousElement: Element) => {
      const exists = currentElements.some(
        (e: Element) => e.elementId === previousElement.elementId
      );

      if (!exists) {
        changes.push({
          type: "element:deleted",
          pageId: currentPage.pageId,
          elementId: previousElement.elementId,
        });
      }
    });
  });

  // Detect deleted pages
  previousPages.forEach((previousPage, index) => {
    if (!currentPages[index] || currentPages[index].pageId !== previousPage.pageId) {
      changes.push({
        type: "page:deleted",
        pageId: previousPage.pageId,
        pageNumber: previousPage.pageNumber,
      });
    }
  });

  return changes;
}

/**
 * Get differences between two elements
 */
function getElementDiff(
  previous: Element,
  current: Element
): Partial<Element> {
  const diff: Partial<Element> = {};

  (Object.keys(current) as (keyof Element)[]).forEach((key) => {
    if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
      diff[key] = current[key] as any;
    }
  });

  return diff;
}

/**
 * Emit changes to server via WebSocket
 */
function emitChanges(socket: Socket, changes: any[]): void {
  const documentStore = useDocumentStore.getState();
  const documentId = documentStore.documentId;

  if (!documentId) {
    return;
  }

  changes.forEach((change) => {
    switch (change.type) {
      case "element:created":
        socket.emit("element:create", {
          documentId,
          pageId: change.pageId,
          element: change.element,
        });
        break;

      case "element:updated":
        socket.emit("element:update", {
          documentId,
          pageId: change.pageId,
          elementId: change.elementId,
          changes: change.changes,
          version: documentStore.version,
        });
        break;

      case "element:deleted":
        socket.emit("element:delete", {
          documentId,
          pageId: change.pageId,
          elementId: change.elementId,
          version: documentStore.version,
        });
        break;

      case "page:added":
        // Emit page added event if needed
        break;

      case "page:deleted":
        // Emit page deleted event if needed
        break;
    }
  });
}

/**
 * Handle version changes
 */
function handleVersionChanged(_socket: Socket, _version: number): void {
  const documentStore = useDocumentStore.getState();
  const documentId = documentStore.documentId;

  if (!documentId) {
    return;
  }

  // Optionally notify server of version change
}

/**
 * Setup WebSocket event listeners
 */
function setupSocketListeners(socket: Socket): void {
  const documentStore = useDocumentStore.getState();
  const collaborationStore = useCollaborationStore.getState();

  // Element created by another user
  socket.on("element:created", (data) => {
    const { pageId, element, userId } = data;

    // Don't apply our own changes
    if (userId === collaborationStore.currentUserId) {
      return;
    }

    const page = documentStore.pages.find((p) => p.pageId === pageId);
    if (page) {
      documentStore.updatePage(pageId, {
        elements: [...page.elements, element],
      });
    }
  });

  // Element updated by another user
  socket.on("element:updated", (data) => {
    const { pageId, elementId, changes, userId } = data;

    // Don't apply our own changes
    if (userId === collaborationStore.currentUserId) {
      return;
    }

    const page = documentStore.pages.find((p) => p.pageId === pageId);
    if (page) {
      const elementIndex = page.elements.findIndex(
        (e) => e.elementId === elementId
      );

      if (elementIndex !== -1) {
        const updatedElements = [...page.elements];
        updatedElements[elementIndex] = {
          ...updatedElements[elementIndex],
          ...changes,
        };

        documentStore.updatePage(pageId, {
          elements: updatedElements,
        });
      }
    }
  });

  // Element deleted by another user
  socket.on("element:deleted", (data) => {
    const { pageId, elementId, userId } = data;

    // Don't apply our own changes
    if (userId === collaborationStore.currentUserId) {
      return;
    }

    const page = documentStore.pages.find((p) => p.pageId === pageId);
    if (page) {
      documentStore.updatePage(pageId, {
        elements: page.elements.filter((e) => e.elementId !== elementId),
      });
    }
  });

  // Handle sync conflicts
  socket.on("sync:conflict", (data) => {
    const { resolution } = data;

    // Handle conflict based on resolution strategy
    if (resolution === "server-wins") {
      // Apply server data
      // Implementation depends on conflict data structure
    }
  });

  // Handle document saved event
  socket.on("document:saved", (data) => {
    documentStore.setVersion(data.version);
    documentStore.markSaved();
  });
}

/**
 * Cleanup sync middleware
 */
export function cleanupSyncMiddleware(): void {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
  pendingChanges.clear();
}
