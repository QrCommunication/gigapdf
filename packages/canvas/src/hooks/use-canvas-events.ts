/**
 * React hook for managing canvas events
 */

import { useEffect, useCallback } from "react";
import * as fabric from "fabric";

export interface CanvasEventHandlers {
  onObjectAdded?: (e: fabric.IEvent) => void;
  onObjectRemoved?: (e: fabric.IEvent) => void;
  onObjectModified?: (e: fabric.IEvent) => void;
  onObjectSelected?: (e: fabric.IEvent) => void;
  onSelectionCleared?: (e: fabric.IEvent) => void;
  onSelectionCreated?: (e: fabric.IEvent) => void;
  onSelectionUpdated?: (e: fabric.IEvent) => void;
  onMouseDown?: (e: fabric.IEvent) => void;
  onMouseMove?: (e: fabric.IEvent) => void;
  onMouseUp?: (e: fabric.IEvent) => void;
  onMouseOver?: (e: fabric.IEvent) => void;
  onMouseOut?: (e: fabric.IEvent) => void;
  onMouseWheel?: (e: fabric.IEvent) => void;
  onPathCreated?: (e: fabric.IEvent) => void;
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
    if (onObjectAdded) canvas.on("object:added", onObjectAdded);
    if (onObjectRemoved) canvas.on("object:removed", onObjectRemoved);
    if (onObjectModified) canvas.on("object:modified", onObjectModified);

    // Selection events
    if (onObjectSelected) canvas.on("selection:created", onObjectSelected);
    if (onSelectionCleared) canvas.on("selection:cleared", onSelectionCleared);
    if (onSelectionCreated) canvas.on("selection:created", onSelectionCreated);
    if (onSelectionUpdated) canvas.on("selection:updated", onSelectionUpdated);

    // Mouse events
    if (onMouseDown) canvas.on("mouse:down", onMouseDown);
    if (onMouseMove) canvas.on("mouse:move", onMouseMove);
    if (onMouseUp) canvas.on("mouse:up", onMouseUp);
    if (onMouseOver) canvas.on("mouse:over", onMouseOver);
    if (onMouseOut) canvas.on("mouse:out", onMouseOut);
    if (onMouseWheel) canvas.on("mouse:wheel", onMouseWheel);

    // Path events
    if (onPathCreated) canvas.on("path:created", onPathCreated);

    return () => {
      if (onObjectAdded) canvas.off("object:added", onObjectAdded);
      if (onObjectRemoved) canvas.off("object:removed", onObjectRemoved);
      if (onObjectModified) canvas.off("object:modified", onObjectModified);
      if (onObjectSelected) canvas.off("selection:created", onObjectSelected);
      if (onSelectionCleared) canvas.off("selection:cleared", onSelectionCleared);
      if (onSelectionCreated) canvas.off("selection:created", onSelectionCreated);
      if (onSelectionUpdated) canvas.off("selection:updated", onSelectionUpdated);
      if (onMouseDown) canvas.off("mouse:down", onMouseDown);
      if (onMouseMove) canvas.off("mouse:move", onMouseMove);
      if (onMouseUp) canvas.off("mouse:up", onMouseUp);
      if (onMouseOver) canvas.off("mouse:over", onMouseOver);
      if (onMouseOut) canvas.off("mouse:out", onMouseOut);
      if (onMouseWheel) canvas.off("mouse:wheel", onMouseWheel);
      if (onPathCreated) canvas.off("path:created", onPathCreated);
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

    const handler = (e: fabric.IEvent) => {
      if (e.target) {
        callback(e.target);
      }
    };

    canvas.on("object:modified", handler);

    return () => {
      canvas.off("object:modified", handler);
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

    const handleSelectionCreated = (e: fabric.IEvent) => {
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

    const handleSelectionCleared = () => {
      if (callbacks.onDeselect) {
        callbacks.onDeselect();
      }
    };

    canvas.on("selection:created", handleSelectionCreated);
    canvas.on("selection:updated", handleSelectionCreated);
    canvas.on("selection:cleared", handleSelectionCleared);

    return () => {
      canvas.off("selection:created", handleSelectionCreated);
      canvas.off("selection:updated", handleSelectionCreated);
      canvas.off("selection:cleared", handleSelectionCleared);
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
