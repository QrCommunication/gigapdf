"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";

/**
 * Local mirror of the ElementObjectData shape used by render-elements.ts.
 * Kept narrow (only the fields this hook inspects) so it stays decoupled
 * from the renderer's internal type.
 */
interface ElementObjectDataLike {
  elementId?: string;
  type?: string;
  isPdfBackground?: boolean;
  isHideMask?: boolean;
  redactionMark?: boolean;
  [key: string]: unknown;
}

/** Fabric object extended with the optional data bag set by the renderer. */
interface FabricObjectWithData extends FabricObject {
  data?: ElementObjectDataLike;
}

/**
 * Sortable element descriptor: only objects that are selectable and not
 * internal helpers (background image, hide masks, redaction marks) enter the
 * tab order. Sorted top-left → bottom-right per page.
 */
interface TabOrderEntry {
  obj: FabricObject;
  elementId: string;
  type: string;
}

/** Announceable event kinds — kept narrow so the live region stays concise. */
type AriaAnnouncement =
  | { kind: "selected"; elementType: string }
  | { kind: "moved"; dx: number; dy: number }
  | { kind: "deleted" }
  | { kind: "edit-entered" }
  | { kind: "edit-exited" }
  | { kind: "all-selected"; count: number };

/** Format an announcement into a screen-reader-friendly French sentence. */
function formatAnnouncement(a: AriaAnnouncement): string {
  switch (a.kind) {
    case "selected":
      return `Élément ${a.elementType} sélectionné`;
    case "moved":
      return `Déplacé de ${Math.abs(a.dx)} px horizontalement, ${Math.abs(a.dy)} px verticalement`;
    case "deleted":
      return "Élément supprimé";
    case "edit-entered":
      return "Session d'édition ouverte";
    case "edit-exited":
      return "Session d'édition fermée";
    case "all-selected":
      return `${a.count} éléments sélectionnés`;
  }
}

/** Human-readable element type label for announcements. */
function elementTypeLabel(obj: FabricObject): string {
  const data = (obj as FabricObjectWithData).data;
  const t = data?.type ?? obj.type ?? "inconnu";
  switch (t) {
    case "text":
    case "i-text":
    case "textbox":
      return "texte";
    case "image":
      return "image";
    case "rect":
      return "rectangle";
    case "circle":
      return "cercle";
    case "line":
      return "ligne";
    case "path":
      return "forme";
    default:
      return t;
  }
}

/**
 * Decide whether a Fabric object should participate in keyboard navigation.
 * Excludes backgrounds, hide-masks, redaction markers and any non-selectable
 * object that is not meant to be user-editable.
 */
function isNavigable(obj: FabricObject): boolean {
  if (!obj.selectable && !obj.evented) return false;
  const data = (obj as FabricObjectWithData).data;
  if (!data) return false;
  if (data.isPdfBackground) return false;
  if (data.isHideMask) return false;
  if (data.redactionMark) return false;
  // Must carry an elementId to be addressable by the rest of the editor.
  if (typeof data.elementId !== "string") return false;
  return true;
}

/** Compare two navigable objects by position (top-left → bottom-right). */
function compareTabOrder(a: TabOrderEntry, b: TabOrderEntry): number {
  const ay = a.obj.top ?? 0;
  const by = b.obj.top ?? 0;
  if (ay !== by) return ay - by;
  const ax = a.obj.left ?? 0;
  const bx = b.obj.left ?? 0;
  return ax - bx;
}

export interface UseCanvasKeyboardNavigationResult {
  /** Attach to the wrapper that owns the Fabric canvas element. */
  canvasWrapperRef: React.RefCallback<HTMLDivElement>;
  /** Current aria-live text to render inside a sr-only polite region. */
  ariaLiveText: string;
}

/**
 * Keyboard accessibility layer for the Fabric PDF editor canvas.
 *
 * Responsibilities:
 * - Maintain a sorted tab order of navigable elements.
 * - Handle Tab / Shift+Tab to move selection along that order.
 * - Arrow keys nudge the selected element (1px, or 10px with Shift).
 * - Enter opens inline editing on text objects; Escape exits it or deselects.
 * - Delete / Backspace removes the selected element via the provided callback.
 * - Ctrl+A selects all navigable elements.
 * - Emits concise French aria-live announcements for screen readers.
 *
 * The hook does NOT import DOM globals at module scope so it remains
 * testable in isolation (callers provide the wrapper ref + callbacks).
 */
export function useCanvasKeyboardNavigation(
  canvas: FabricCanvas | null,
  options: {
    onDeleteSelected?: () => void;
    onSelectAll?: () => void;
  } = {},
): UseCanvasKeyboardNavigationResult {
  const [ariaLiveText, setAriaLiveText] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const tabOrderRef = useRef<TabOrderEntry[]>([]);
  const lastAnnouncementRef = useRef<string>("");

  // Rebuild the tab order from current canvas objects. Called on structural
  // changes (add/remove/modify) and lazily before each Tab press.
  const rebuildTabOrder = useCallback(() => {
    if (!canvas) {
      tabOrderRef.current = [];
      return;
    }
    const entries: TabOrderEntry[] = [];
    for (const obj of canvas.getObjects()) {
      if (!isNavigable(obj)) continue;
      const data = (obj as FabricObjectWithData).data!;
      entries.push({
        obj,
        elementId: String(data.elementId),
        type: String(data.type ?? obj.type ?? "unknown"),
      });
    }
    entries.sort(compareTabOrder);
    tabOrderRef.current = entries;
  }, [canvas]);

  // Keep a stable announce helper that dedupes identical consecutive messages
  // (screen readers re-read every change, even if the text is identical).
  const announce = useCallback((a: AriaAnnouncement) => {
    const text = formatAnnouncement(a);
    if (text === lastAnnouncementRef.current) {
      // Force a re-announcement by toggling a zero-width suffix when the
      // message is genuinely repeated (e.g. two consecutive moves).
      const suffixed = text.endsWith("​") ? text.slice(0, -1) : text + "​";
      lastAnnouncementRef.current = suffixed;
      setAriaLiveText(suffixed);
    } else {
      lastAnnouncementRef.current = text;
      setAriaLiveText(text);
    }
  }, []);

  // Index of the currently-selected element inside tabOrderRef, or -1.
  const selectedIndex = useCallback((): number => {
    const active = canvas?.getActiveObject() ?? null;
    if (!active) return -1;
    const data = (active as FabricObjectWithData).data;
    const id = typeof data?.elementId === "string" ? data.elementId : null;
    if (!id) return -1;
    return tabOrderRef.current.findIndex((e) => e.elementId === id);
  }, [canvas]);

  const selectByIndex = useCallback(
    (idx: number) => {
      if (!canvas) return;
      const entry = tabOrderRef.current[idx];
      if (!entry) return;
      canvas.setActiveObject(entry.obj);
      canvas.requestRenderAll();
      announce({ kind: "selected", elementType: elementTypeLabel(entry.obj) });
    },
    [canvas, announce],
  );

  // Nudge the active object by (dx, dy) canvas units and persist the move
  // through Fabric's standard modified path so the editor's save picks it up.
  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active || !isNavigable(active)) return;
      const prevLeft = active.left ?? 0;
      const prevTop = active.top ?? 0;
      active.set({ left: prevLeft + dx, top: prevTop + dy });
      active.setCoords();
      canvas.requestRenderAll();
      // Fire the same event the drag handler uses so the operations-store
      // queues an update and the save pipeline persists the new bounds.
      canvas.fire("object:modified", { target: active });
      announce({ kind: "moved", dx, dy });
    },
    [canvas, announce],
  );

  const enterEditing = useCallback(() => {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    const editable = active as FabricObject & {
      enterEditing?: () => void;
      isEditing?: boolean;
    };
    if (typeof editable.enterEditing === "function") {
      editable.enterEditing();
      canvas.requestRenderAll();
      announce({ kind: "edit-entered" });
    }
  }, [canvas, announce]);

  const exitEditingOrDeselect = useCallback(() => {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    const editable = active as FabricObject & {
      exitEditing?: () => void;
      isEditing?: boolean;
    };
    if (editable?.isEditing && typeof editable.exitEditing === "function") {
      editable.exitEditing();
      canvas.requestRenderAll();
      announce({ kind: "edit-exited" });
      return;
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [canvas, announce]);

  const deleteSelected = useCallback(() => {
    if (!options.onDeleteSelected) return;
    options.onDeleteSelected();
    announce({ kind: "deleted" });
  }, [options, announce]);

  const selectAll = useCallback(() => {
    if (!canvas) return;
    if (options.onSelectAll) {
      options.onSelectAll();
    } else {
      // Fallback: build an ActiveSelection from every navigable object.
      const targets = tabOrderRef.current.map((e) => e.obj);
      if (targets.length === 0) return;
      // Fabric v6 exposes fabric.ActiveSelection; fall back gracefully.
      const fabricModule = (canvas as unknown as { constructor: { ActiveSelection?: new (objs: FabricObject[]) => FabricObject } }).constructor;
      if (typeof fabricModule.ActiveSelection === "function") {
        const sel = new fabricModule.ActiveSelection(targets);
        canvas.setActiveObject(sel);
      } else {
        // Single-object fallback when ActiveSelection is unavailable.
        canvas.setActiveObject(targets[0]!);
      }
      canvas.requestRenderAll();
    }
    announce({ kind: "all-selected", count: tabOrderRef.current.length });
  }, [canvas, options, announce]);

  // Keydown handler attached to the wrapper div (not window) so the canvas
  // only captures shortcuts when it actually has focus.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignore when focus is inside an actual input/textarea/contenteditable
      // nested within the wrapper (e.g. properties panel embedded nearby).
      const ae = document.activeElement;
      if (ae && ae !== wrapperRef.current) {
        const tag = (ae as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (ae as HTMLElement).isContentEditable) {
          return;
        }
      }

      // Tab navigation along the sorted element list.
      if (event.key === "Tab") {
        event.preventDefault();
        rebuildTabOrder();
        const order = tabOrderRef.current;
        if (order.length === 0) return;
        const cur = selectedIndex();
        const next = event.shiftKey
          ? (cur <= 0 ? order.length - 1 : cur - 1)
          : (cur < 0 || cur >= order.length - 1 ? 0 : cur + 1);
        selectByIndex(next);
        return;
      }

      // Arrow nudges (1px, 10px with Shift).
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        switch (event.key) {
          case "ArrowUp":
            nudgeSelected(0, -step);
            break;
          case "ArrowDown":
            nudgeSelected(0, step);
            break;
          case "ArrowLeft":
            nudgeSelected(-step, 0);
            break;
          case "ArrowRight":
            nudgeSelected(step, 0);
            break;
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        enterEditing();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        exitEditingOrDeselect();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        rebuildTabOrder();
        selectAll();
        return;
      }
    },
    [
      rebuildTabOrder,
      selectedIndex,
      selectByIndex,
      nudgeSelected,
      enterEditing,
      exitEditingOrDeselect,
      deleteSelected,
      selectAll,
    ],
  );

  // Subscribe to canvas structural events so the tab order stays fresh.
  useEffect(() => {
    if (!canvas) return;
    const refresh = () => rebuildTabOrder();
    canvas.on("object:added", refresh);
    canvas.on("object:removed", refresh);
    canvas.on("object:modified", refresh);
    return () => {
      canvas.off("object:added", refresh);
      canvas.off("object:removed", refresh);
      canvas.off("object:modified", refresh);
    };
  }, [canvas, rebuildTabOrder]);

  // Attach / detach the keydown listener on the wrapper element.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Ref callback so callers can spread {...canvasWrapperProps} onto their div.
  const canvasWrapperRef = useCallback((node: HTMLDivElement | null) => {
    wrapperRef.current = node;
  }, []);

  return { canvasWrapperRef, ariaLiveText };
}