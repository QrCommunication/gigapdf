/**
 * React hook for managing canvas selection
 */

import { useEffect, useState, useCallback } from "react";
import * as fabric from "fabric";

export interface UseSelectionReturn {
  selectedObjects: fabric.Object[];
  activeObject: fabric.Object | null;
  hasSelection: boolean;
  selectObject: (obj: fabric.Object) => void;
  selectObjects: (objects: fabric.Object[]) => void;
  clearSelection: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => Promise<void>;
  groupSelected: () => void;
  ungroupSelected: () => void;
}

/**
 * Hook for managing canvas selection
 */
export function useSelection(canvas: fabric.Canvas | null): UseSelectionReturn {
  const [selectedObjects, setSelectedObjects] = useState<fabric.Object[]>([]);
  const [activeObject, setActiveObject] = useState<fabric.Object | null>(null);

  useEffect(() => {
    if (!canvas) return;

    const updateSelection = () => {
      const active = canvas.getActiveObject();
      setActiveObject(active || null);

      if (active instanceof fabric.ActiveSelection) {
        setSelectedObjects(active.getObjects());
      } else if (active) {
        setSelectedObjects([active]);
      } else {
        setSelectedObjects([]);
      }
    };

    updateSelection();

    canvas.on("selection:created", updateSelection);
    canvas.on("selection:updated", updateSelection);
    canvas.on("selection:cleared", updateSelection);

    return () => {
      canvas.off("selection:created", updateSelection);
      canvas.off("selection:updated", updateSelection);
      canvas.off("selection:cleared", updateSelection);
    };
  }, [canvas]);

  const selectObject = useCallback(
    (obj: fabric.Object) => {
      if (!canvas) return;
      canvas.setActiveObject(obj);
      canvas.renderAll();
    },
    [canvas]
  );

  const selectObjects = useCallback(
    (objects: fabric.Object[]) => {
      if (!canvas || objects.length === 0) return;

      if (objects.length === 1) {
        selectObject(objects[0]);
      } else {
        const selection = new fabric.ActiveSelection(objects, {
          canvas,
        });
        canvas.setActiveObject(selection);
        canvas.renderAll();
      }
    },
    [canvas, selectObject]
  );

  const clearSelection = useCallback(() => {
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();
  }, [canvas]);

  const deleteSelected = useCallback(() => {
    if (!canvas || selectedObjects.length === 0) return;

    selectedObjects.forEach((obj) => canvas.remove(obj));
    canvas.renderAll();
  }, [canvas, selectedObjects]);

  const duplicateSelected = useCallback(async () => {
    if (!canvas || selectedObjects.length === 0) return;

    const clones: fabric.Object[] = [];

    for (const obj of selectedObjects) {
      const clone = await new Promise<fabric.Object>((resolve) => {
        obj.clone((cloned: fabric.Object) => {
          cloned.set({
            left: (cloned.left || 0) + 10,
            top: (cloned.top || 0) + 10,
          });
          resolve(cloned);
        });
      });

      canvas.add(clone);
      clones.push(clone);
    }

    selectObjects(clones);
    canvas.renderAll();
  }, [canvas, selectedObjects, selectObjects]);

  const groupSelected = useCallback(() => {
    if (!canvas || selectedObjects.length < 2) return;

    const group = new fabric.Group(selectedObjects, {
      canvas,
    });

    selectedObjects.forEach((obj) => canvas.remove(obj));
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.renderAll();
  }, [canvas, selectedObjects]);

  const ungroupSelected = useCallback(() => {
    if (!canvas || !activeObject) return;
    if (!(activeObject instanceof fabric.Group)) return;

    const objects = activeObject.getObjects();
    activeObject.destroy();
    canvas.remove(activeObject);

    objects.forEach((obj) => canvas.add(obj));
    selectObjects(objects);
    canvas.renderAll();
  }, [canvas, activeObject, selectObjects]);

  return {
    selectedObjects,
    activeObject,
    hasSelection: selectedObjects.length > 0,
    selectObject,
    selectObjects,
    clearSelection,
    deleteSelected,
    duplicateSelected,
    groupSelected,
    ungroupSelected,
  };
}
