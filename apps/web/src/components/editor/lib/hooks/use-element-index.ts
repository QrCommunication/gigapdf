"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";

/**
 * Shape of the data bag attached to Fabric objects in the editor.
 * Only the fields relevant to indexing are typed here; the rest is opaque.
 */
interface EditorFabricData {
  elementId?: string;
  [key: string]: unknown;
}

/** Narrow a FabricObject to one carrying our editor data bag. */
type FabricObjectWithData = FabricObject & { data?: EditorFabricData };

/** Return value of the useElementIndex hook. */
export interface ElementIndexApi {
  /** O(1) lookup of a canvas object by its elementId. */
  getElementById: (id: string) => FabricObject | undefined;
  /**
   * Iterate over all indexed objects (those carrying a non-empty elementId).
   * Use this instead of canvas.getObjects() when you need to scan only
   * real scene-graph elements and can skip badges/backgrounds/masks.
   */
  forEachIndexed: (cb: (obj: FabricObject, elementId: string) => void) => void;
  /**
   * Rebuild the full index from the current canvas contents.
   * Call after loadFromJSON, history restore, or any bulk mutation
   * that bypasses per-object events.
   */
  rebuildIndex: () => void;
}

/**
 * Maintains a Map<elementId, FabricObject> kept in sync with canvas events
 * so callers can resolve objects by id in O(1) instead of scanning
 * canvas.getObjects() on every call.
 *
 * The map tracks only objects whose `data.elementId` is a non-empty string.
 * Badges, backgrounds, hide-masks and other auxiliary objects are excluded
 * automatically because they carry no elementId.
 */
export function useElementIndex(
  canvasRef: React.RefObject<FabricCanvas | null>,
): ElementIndexApi {
  // Stable mutable map — never exposed directly to avoid accidental iteration.
  const indexRef = useRef<Map<string, FabricObject>>(new Map());

  const getElementById = useCallback(
    (id: string): FabricObject | undefined => indexRef.current.get(id),
    [],
  );

  const forEachIndexed = useCallback(
    (cb: (obj: FabricObject, elementId: string) => void) => {
      for (const [elementId, obj] of indexRef.current) {
        cb(obj, elementId);
      }
    },
    [],
  );

  const rebuildIndex = useCallback(() => {
    const canvas = canvasRef.current;
    const next = new Map<string, FabricObject>();
    if (canvas) {
      for (const obj of canvas.getObjects()) {
        const elementId = (obj as FabricObjectWithData).data?.elementId;
        if (typeof elementId === "string" && elementId.length > 0) {
          next.set(elementId, obj);
        }
      }
    }
    indexRef.current = next;
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Seed the index with whatever is already on the canvas (e.g. after SSR
    // hydration or a parent-driven initial render before this effect mounts).
    rebuildIndex();

    const handleAdded = (opt: { target?: FabricObject }) => {
      const obj = opt.target;
      if (!obj) return;
      const elementId = (obj as FabricObjectWithData).data?.elementId;
      if (typeof elementId === "string" && elementId.length > 0) {
        indexRef.current.set(elementId, obj);
      }
    };

    const handleRemoved = (opt: { target?: FabricObject }) => {
      const obj = opt.target;
      if (!obj) return;
      const elementId = (obj as FabricObjectWithData).data?.elementId;
      if (typeof elementId === "string" && elementId.length > 0) {
        // Only delete if the map still points to THIS exact instance —
        // a replacement with the same elementId may have been added first.
        if (indexRef.current.get(elementId) === obj) {
          indexRef.current.delete(elementId);
        }
      }
    };

    const handleModified = (opt: { target?: FabricObject }) => {
      // elementId mutations are rare but possible (e.g. paragraph session
      // commit reassigns ids). Re-index conservatively: remove old key if
      // present, then add under the current key.
      const obj = opt.target;
      if (!obj) return;
      const elementId = (obj as FabricObjectWithData).data?.elementId;
      // Purge any stale entry pointing at this instance.
      for (const [key, val] of indexRef.current) {
        if (val === obj && key !== elementId) {
          indexRef.current.delete(key);
        }
      }
      if (typeof elementId === "string" && elementId.length > 0) {
        indexRef.current.set(elementId, obj);
      }
    };

    canvas.on("object:added", handleAdded as never);
    canvas.on("object:removed", handleRemoved as never);
    canvas.on("object:modified", handleModified as never);

    return () => {
      canvas.off("object:added", handleAdded as never);
      canvas.off("object:removed", handleRemoved as never);
      canvas.off("object:modified", handleModified as never);
    };
  }, [canvasRef, rebuildIndex]);

  return { getElementById, forEachIndexed, rebuildIndex };
}