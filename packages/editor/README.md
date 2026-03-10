# @giga-pdf/editor

State management package for the Giga-PDF editor using Zustand with Immer middleware.

## Features

- **Document Store**: Manages document metadata, pages, and elements
- **Canvas Store**: Controls zoom, pan, active tool, and viewport
- **Selection Store**: Handles element selection and multi-select
- **History Store**: Undo/redo with 50-entry stack limit
- **Collaboration Store**: Real-time users, cursors, and element locks
- **UI Store**: Panels, modals, notifications, and preferences
- **Actions**: High-level functions for common operations
- **Selectors**: Memoized selectors for efficient state access
- **Middleware**: WebSocket sync and auto-save functionality

## Installation

```bash
pnpm install @giga-pdf/editor
```

## Usage

### Basic Setup

```typescript
import {
  useDocumentStore,
  useCanvasStore,
  useSelectionStore,
  createElement,
  addPage,
} from "@giga-pdf/editor";

function MyComponent() {
  const pages = useDocumentStore((state) => state.pages);
  const zoom = useCanvasStore((state) => state.zoom);
  const selectedIds = useSelectionStore((state) => state.selectedElementIds);

  return <div>...</div>;
}
```

### Document Operations

```typescript
import { useDocumentStore, addPage, removePage } from "@giga-pdf/editor";

// Load a document
const { setDocument } = useDocumentStore.getState();
setDocument(documentId, "My Document", pages);

// Add a page
const newPageId = addPage({ index: 0 });

// Remove a page
removePage({ pageId });
```

### Element Operations

```typescript
import {
  createElement,
  updateElement,
  deleteElement,
  duplicateElement,
} from "@giga-pdf/editor";

// Create an element
const elementId = createElement({
  pageId,
  element: {
    type: "text",
    bounds: { x: 100, y: 100, width: 200, height: 50 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    content: "Hello World",
    style: {
      fontFamily: "Arial",
      fontSize: 16,
      color: "#000000",
      // ... other text style properties
    },
    // ... other required properties
  },
});

// Update an element
updateElement({
  pageId,
  elementId,
  updates: { bounds: { x: 150, y: 150, width: 200, height: 50 } },
});

// Delete an element
deleteElement({ pageId, elementId });

// Duplicate an element
const duplicatedId = duplicateElement({ pageId, elementId });
```

### Selection Operations

```typescript
import {
  selectElement,
  selectElements,
  clearSelection,
  selectAllOnPage,
} from "@giga-pdf/editor";

// Select a single element
selectElement(elementId, pageId);

// Multi-select
selectElement(elementId2, pageId, true);

// Select multiple elements
selectElements([id1, id2, id3], pageId);

// Select all on page
selectAllOnPage(pageId);

// Clear selection
clearSelection();
```

### History (Undo/Redo)

```typescript
import { undo, redo, canUndo, canRedo } from "@giga-pdf/editor";

// Undo last action
if (canUndo()) {
  undo();
}

// Redo
if (canRedo()) {
  redo();
}
```

### Canvas Controls

```typescript
import { useCanvasStore } from "@giga-pdf/editor";

const {
  setZoom,
  zoomIn,
  zoomOut,
  setPan,
  setActiveTool,
  setCurrentPage,
} = useCanvasStore.getState();

// Zoom
setZoom(1.5);
zoomIn();
zoomOut();

// Pan
setPan(100, 200);

// Set active tool
setActiveTool("text");

// Navigate pages
setCurrentPage(2);
```

### Real-time Collaboration

```typescript
import { io } from "socket.io-client";
import {
  useCollaborationStore,
  initSyncMiddleware,
} from "@giga-pdf/editor";

// Connect to WebSocket
const socket = io("wss://api.example.com");

// Initialize sync middleware
const cleanup = initSyncMiddleware(socket, {
  enabled: true,
  debounceMs: 300,
  conflictResolution: "server-wins",
});

// Access collaboration data
const { onlineUsers, cursors, elementLocks } = useCollaborationStore.getState();

// Cleanup on unmount
cleanup();
```

### Auto-save

```typescript
import {
  initPersistenceMiddleware,
  saveToLocalStorage,
  loadFromLocalStorage,
} from "@giga-pdf/editor";

// Initialize auto-save with API callback
const cleanup = initPersistenceMiddleware(
  async (data) => {
    await fetch("/api/documents/save", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  {
    enabled: true,
    debounceMs: 2000,
  }
);

// Or use local storage
saveToLocalStorage();
loadFromLocalStorage();

// Cleanup on unmount
cleanup();
```

### Selectors

```typescript
import {
  useCurrentPage,
  usePageElements,
  useElement,
  useDocumentStats,
} from "@giga-pdf/editor";

function MyComponent() {
  const currentPage = useCurrentPage();
  const elements = usePageElements(pageId);
  const element = useElement(pageId, elementId);
  const stats = useDocumentStats();

  return <div>...</div>;
}
```

## Store Architecture

### Document Store
- Document metadata (ID, title, version)
- Pages array with elements
- Dirty state and loading status
- Last saved timestamp

### Canvas Store
- Zoom level (0.1 - 5.0)
- Pan offset
- Active tool and subtype
- Viewport dimensions
- Grid and ruler settings
- Current page index

### Selection Store
- Selected element IDs (Set)
- Selected page ID
- Multi-select state
- Selection bounds
- Hovered element ID

### History Store
- Undo stack (max 50 entries)
- Redo stack
- Snapshots with timestamp and description

### Collaboration Store
- WebSocket connection
- Online users (Map)
- User cursors (Map)
- Element locks (Map)

### UI Store
- Sidebar state (open/closed, width, active panel)
- Modal state (type, data)
- Theme preference
- Grid and guide visibility
- Notifications array
- Context menu state

## TypeScript Support

Full TypeScript support with strict mode enabled. All stores, actions, and selectors are fully typed.

## License

Private package for Giga-PDF project.
