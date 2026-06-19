/**
 * React hook for managing canvas events
 */

import { useEffect } from "react";
import * as fabric from "fabric";

/**
 * Fabric v6/v7 replaced the single `IEvent` type with per-event payload
 * shapes (`CanvasEvents`). We surface a permissive payload union so the
 * generic handler props below can read `target`/`selected`/`e` regardless of
 * which concrete event fired, and cast at each `canvas.on(...)` registration
 * (Fabric strongly types each event name).
 */
type AnyCanvasEvent = Partial<
  fabric.TPointerEventInfo<fabric.TPointerEvent>
> & {
  target?: fabric.FabricObject;
  selected?: fabric.FabricObject[];
  deselected?: fabric.FabricObject[];
  path?: fabric.FabricObject;
};

export interface CanvasEventHandlers {
  onObjectAdded?: (e: AnyCanvasEvent) => void;
  onObjectRemoved?: (e: AnyCanvasEvent) => void;
  onObjectModified?: (e: AnyCanvasEvent) => void;
  onObjectSelected?: (e: AnyCanvasEvent) => void;
  onSelectionCleared?: (e: AnyCanvasEvent) => void;
  onSelectionCreated?: (e: AnyCanvasEvent) => void;
  onSelectionUpdated?: (e: AnyCanvasEvent) => void;
  onMouseDown?: (e: AnyCanvasEvent) => void;
  onMouseMove?: (e: AnyCanvasEvent) => void;
  onMouseUp?: (e: AnyCanvasEvent) => void;
  onMouseOver?: (e: AnyCanvasEvent) => void;
  onMouseOut?: (e: AnyCanvasEvent) => void;
  onMouseWheel?: (e: AnyCanvasEvent) => void;
  onPathCreated?: (e: AnyCanvasEvent) => void;
}

/**
 * Fabric's `canvas.on(name, handler)` overload narrows the handler to that
 * specific event payload. Our generic handlers accept a superset (`AnyCanvasEvent`),
 * so we register through this typed bridge — the cast is sound because every
 * field a handler reads is optional on `AnyCanvasEvent`.
 */
type FabricEventHandler = (e: AnyCanvasEvent) => void;
function on(
  canvas: fabric.Canvas,
  name: keyof fabric.CanvasEvents,
  handler: FabricEventHandler
): void {
  canvas.on(name, handler as never);
}
function off(
  canvas: fabric.Canvas,
  name: keyof fabric.CanvasEvents,
  handler: FabricEventHandler
): void {
  canvas.off(name, handler as never);
}

/**
 * Hook for managing canvas events
 */
export function useCanvasEvents(
  canvas: fabric.Canvas | null,
  handlers: CanvasEventHandlers
) {
  useEffect(() => {
    if (!canvas) return;

    const {
      onObjectAdded,
      onObjectRemoved,
      onObjectModified,
      onObjectSelected,
      onSelectionCleared,
      onSelectionCreated,
      onSelectionUpdated,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseOver,
      onMouseOut,
      onMouseWheel,
      onPathCreated,
    } = handlers;

    // Object events
    if (onObjectAdded) on(canvas, "object:added", onObjectAdded);
    if (onObjectRemoved) on(canvas, "object:removed", onObjectRemoved);
    if (onObjectModified) on(canvas, "object:modified", onObjectModified);

    // Selection events
    if (onObjectSelected) on(canvas, "selection:created", onObjectSelected);
    if (onSelectionCleared) on(canvas, "selection:cleared", onSelectionCleared);
    if (onSelectionCreated) on(canvas, "selection:created", onSelectionCreated);
    if (onSelectionUpdated) on(canvas, "selection:updated", onSelectionUpdated);

    // Mouse events
    if (onMouseDown) on(canvas, "mouse:down", onMouseDown);
    if (onMouseMove) on(canvas, "mouse:move", onMouseMove);
    if (onMouseUp) on(canvas, "mouse:up", onMouseUp);
    if (onMouseOver) on(canvas, "mouse:over", onMouseOver);
    if (onMouseOut) on(canvas, "mouse:out", onMouseOut);
    if (onMouseWheel) on(canvas, "mouse:wheel", onMouseWheel);

    // Path events
    if (onPathCreated) on(canvas, "path:created", onPathCreated);

    return () => {
      if (onObjectAdded) off(canvas, "object:added", onObjectAdded);
      if (onObjectRemoved) off(canvas, "object:removed", onObjectRemoved);
      if (onObjectModified) off(canvas, "object:modified", onObjectModified);
      if (onObjectSelected) off(canvas, "selection:created", onObjectSelected);
      if (onSelectionCleared) off(canvas, "selection:cleared", onSelectionCleared);
      if (onSelectionCreated) off(canvas, "selection:created", onSelectionCreated);
      if (onSelectionUpdated) off(canvas, "selection:updated", onSelectionUpdated);
      if (onMouseDown) off(canvas, "mouse:down", onMouseDown);
      if (onMouseMove) off(canvas, "mouse:move", onMouseMove);
      if (onMouseUp) off(canvas, "mouse:up", onMouseUp);
      if (onMouseOver) off(canvas, "mouse:over", onMouseOver);
      if (onMouseOut) off(canvas, "mouse:out", onMouseOut);
      if (onMouseWheel) off(canvas, "mouse:wheel", onMouseWheel);
      if (onPathCreated) off(canvas, "path:created", onPathCreated);
    };
  }, [canvas, handlers]);
}

/**
 * Hook for object modification events
 */
export function useObjectModified(
  canvas: fabric.Canvas | null,
  callback: (obj: fabric.Object) => void
) {
  useEffect(() => {
    if (!canvas) return;

    const handler: FabricEventHandler = (e) => {
      if (e.target) {
        callback(e.target);
      }
    };

    on(canvas, "object:modified", handler);

    return () => {
      off(canvas, "object:modified", handler);
    };
  }, [canvas, callback]);
}

/**
 * Hook for selection events
 */
export function useSelectionEvents(
  canvas: fabric.Canvas | null,
  callbacks: {
    onSelect?: (obj: fabric.Object | fabric.Object[]) => void;
    onDeselect?: () => void;
  }
) {
  useEffect(() => {
    if (!canvas) return;

    const handleSelectionCreated: FabricEventHandler = (e) => {
      if (!callbacks.onSelect) return;

      const target = e.selected;
      if (target) {
        if (Array.isArray(target)) {
          callbacks.onSelect(target);
        } else {
          callbacks.onSelect(target as fabric.Object);
        }
      }
    };

    const handleSelectionCleared: FabricEventHandler = () => {
      if (callbacks.onDeselect) {
        callbacks.onDeselect();
      }
    };

    on(canvas, "selection:created", handleSelectionCreated);
    on(canvas, "selection:updated", handleSelectionCreated);
    on(canvas, "selection:cleared", handleSelectionCleared);

    return () => {
      off(canvas, "selection:created", handleSelectionCreated);
      off(canvas, "selection:updated", handleSelectionCreated);
      off(canvas, "selection:cleared", handleSelectionCleared);
    };
  }, [canvas, callbacks]);
}

/**
 * Hook for keyboard events
 */
export function useKeyboardEvents(
  canvas: fabric.Canvas | null,
  handlers: {
    onDelete?: () => void;
    onCopy?: () => void;
    onPaste?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onSelectAll?: () => void;
  }
) {
  useEffect(() => {
    if (!canvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in an input field
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const { key, ctrlKey, metaKey, shiftKey } = e;
      const isMod = ctrlKey || metaKey;

      // Delete
      if ((key === "Delete" || key === "Backspace") && handlers.onDelete) {
        e.preventDefault();
        handlers.onDelete();
      }

      // Copy
      if (isMod && key === "c" && handlers.onCopy) {
        e.preventDefault();
        handlers.onCopy();
      }

      // Paste
      if (isMod && key === "v" && handlers.onPaste) {
        e.preventDefault();
        handlers.onPaste();
      }

      // Undo
      if (isMod && key === "z" && !shiftKey && handlers.onUndo) {
        e.preventDefault();
        handlers.onUndo();
      }

      // Redo
      if (isMod && ((key === "z" && shiftKey) || key === "y") && handlers.onRedo) {
        e.preventDefault();
        handlers.onRedo();
      }

      // Select All
      if (isMod && key === "a" && handlers.onSelectAll) {
        e.preventDefault();
        handlers.onSelectAll();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canvas, handlers]);
}
