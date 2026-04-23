/**
 * @giga-pdf/editor
 *
 * State management for the PDF editor using Zustand
 */

// Export stores
export * from "./stores";

// Export actions
export * from "./actions";

// Export selectors
export * from "./selectors";

// Export middleware
export * from "./middleware";

// Export types
export type {
  DocumentState,
  CanvasState,
  SelectionState,
  HistoryState,
  CollaborationState,
  UIState,
  PanelType,
  ModalType,
  ViewportDimensions,
  HistorySnapshot,
  OnlineUser,
  UserCursor,
  ElementLockInfo,
  Notification,
  ContextMenuItem,
  SyncConfig,
  PersistenceConfig,
} from "./types";

// Re-export commonly used types from @giga-pdf/types
export type {
  UUID,
  Element,
  ElementType,
  PageObject,
  Tool,
  Bounds,
  Point,
  Transform,
} from "@giga-pdf/types";

// Embedded fonts: dynamic font loading from PDF via FontFace API + IndexedDB cache
export { useEmbeddedFonts } from "./hooks/use-embedded-fonts";
export type {
  UseEmbeddedFontsOptions,
  UseEmbeddedFontsResult,
  LoadedFont,
  FontLoadStatus,
} from "./hooks/use-embedded-fonts";
