/**
 * Operations Store - Pending element operations tracker.
 *
 * Queues user-initiated element ops (add/update/delete) so the save flow can
 * apply them to the PDF binary via /api/pdf/apply-elements before uploading
 * to S3. Without this, the server-side PDF stays identical to the source
 * parse and the user's edits silently disappear on reload.
 *
 * Ops stay local (Zustand, not persisted) — the offline queue handles
 * durable cross-reload recovery via `useDocumentSave`.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Element, Bounds, UUID } from "@giga-pdf/types";

export type ElementOperationAction = "add" | "update" | "delete" | "reorder";

export interface ElementOperation {
  action: ElementOperationAction;
  pageNumber: number;
  /**
   * For add/update: the full Element (carries `index` for parsed text runs).
   * For delete: `{ elementId, bounds, index? }` — `index` is the engine
   * text-run index, threaded through so apply-operations can fire the TRUE
   * in-place `removeElement` instead of redact+add. Absent / `< 0` (a sentinel
   * the engine uses for FORM-XObject text) means the delete falls back to
   * redact + add — handled entirely by the engine, never special-cased here.
   * For reorder: the full Element (carries the unified `index`); the new
   * stacking is baked into the PDF via the engine's `reorderElement`.
   */
  element: Element | Record<string, unknown>;
  oldBounds?: Bounds;
  /**
   * For `reorder`: bring the element to the front (`true`) or send it to the
   * back (`false`). Consumed by apply-operations → `reorderElement`.
   */
  reorder?: { toFront: boolean };
}

export interface OperationsStore {
  operations: ElementOperation[];

  /** Queue an add op (new element created via the UI). */
  queueAdd: (pageNumber: number, element: Element) => void;
  /** Queue an update op. oldBounds is required to reclip the previous area. */
  queueUpdate: (
    pageNumber: number,
    element: Element,
    oldBounds: Bounds,
  ) => void;
  /**
   * Queue a delete op. Bounds tell the renderer what region to clear.
   * `index` (engine text-run index, when known) enables the in-place
   * `removeElement` path; omit it for added/non-text elements.
   */
  queueDelete: (
    pageNumber: number,
    elementId: UUID,
    bounds: Bounds,
    index?: number,
  ) => void;
  /**
   * Queue a z-order (reorder) op. Persists the new stacking into the PDF binary
   * via the engine's `reorderElement` (not just the editor scene-graph order).
   * `toFront` brings the element on top; otherwise it is sent behind. Coalesces
   * repeated reorders of the same element — last action wins the final z-order.
   */
  queueReorder: (
    pageNumber: number,
    element: Element,
    toFront: boolean,
  ) => void;

  /** Retrieve and clear all pending operations (consumed during save). */
  drain: () => ElementOperation[];
  /** Peek without clearing. */
  peek: () => ElementOperation[];
  /** Clear without draining (used when save fails and we requeue). */
  clear: () => void;
  /** Requeue a list of operations (e.g., after a failed apply). */
  prepend: (ops: ElementOperation[]) => void;
  /** How many ops are pending. */
  size: () => number;
}

export const useOperationsStore: UseBoundStore<StoreApi<OperationsStore>> =
  create<OperationsStore>()(
    immer((set, get) => ({
      operations: [],

      queueAdd: (pageNumber, element) =>
        set((state) => {
          state.operations.push({
            action: "add",
            pageNumber,
            element,
          });
        }),

      queueUpdate: (pageNumber, element, oldBounds) =>
        set((state) => {
          // Coalesce repeated updates to the same element: keep the FIRST
          // op's oldBounds (the original pre-edit region to redact) and swap
          // in the latest element state. Without this, editing one element N
          // times (font then colour, several textarea commits, repeated
          // drags) queues N update ops, so the redact+add fallback would draw
          // the text N times. The in-place replaceText path is last-wins
          // anyway, so coalescing keeps both paths correct.
          const existing = state.operations.find(
            (op) =>
              op.action === "update" &&
              op.pageNumber === pageNumber &&
              (op.element as Element).elementId === element.elementId,
          );
          if (existing) {
            existing.element = element;
          } else {
            state.operations.push({
              action: "update",
              pageNumber,
              element,
              oldBounds,
            });
          }
        }),

      queueDelete: (pageNumber, elementId, bounds, index) =>
        set((state) => {
          state.operations.push({
            action: "delete",
            pageNumber,
            element: {
              elementId,
              bounds,
              ...(index !== undefined ? { index } : {}),
            },
            oldBounds: bounds,
          });
        }),

      queueReorder: (pageNumber, element, toFront) =>
        set((state) => {
          // Coalesce repeated reorders of the same element on the same page —
          // only the LAST action determines the final z-order, so keep one op
          // per element and overwrite its target + payload.
          const existing = state.operations.find(
            (op) =>
              op.action === "reorder" &&
              op.pageNumber === pageNumber &&
              (op.element as Element).elementId === element.elementId,
          );
          if (existing) {
            existing.element = element;
            existing.reorder = { toFront };
          } else {
            state.operations.push({
              action: "reorder",
              pageNumber,
              element,
              reorder: { toFront },
            });
          }
        }),

      drain: () => {
        const ops = get().operations;
        set((state) => {
          state.operations = [];
        });
        return ops;
      },

      peek: () => get().operations,

      clear: () =>
        set((state) => {
          state.operations = [];
        }),

      prepend: (ops) =>
        set((state) => {
          state.operations = [...ops, ...state.operations];
        }),

      size: () => get().operations.length,
    })),
  );
