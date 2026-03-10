/**
 * React hook for managing canvas zoom
 */

import { useEffect, useState, useCallback } from "react";
import * as fabric from "fabric";
import type { Point } from "@giga-pdf/types";

export interface UseZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  step?: number;
  enableMouseWheel?: boolean;
}

export interface UseZoomReturn {
  zoom: number;
  setZoom: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  zoomToPoint: (point: Point, level: number) => void;
  resetZoom: () => void;
}

/**
 * Hook for managing canvas zoom
 */
export function useZoom(
  canvas: fabric.Canvas | null,
  options: UseZoomOptions = {}
): UseZoomReturn {
  const {
    minZoom = 0.1,
    maxZoom = 10,
    step = 0.1,
    enableMouseWheel = true,
  } = options;

  const [zoom, setZoomState] = useState(1);

  useEffect(() => {
    if (!canvas) return;

    const updateZoom = () => {
      setZoomState(canvas.getZoom());
    };

    updateZoom();
  }, [canvas]);

  useEffect(() => {
    if (!canvas || !enableMouseWheel) return;

    const handleMouseWheel = (opt: fabric.IEvent) => {
      const e = opt.e as WheelEvent;
      const delta = e.deltaY;
      let newZoom = canvas.getZoom();

      newZoom *= 0.999 ** delta;
      newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));

      const pointer = canvas.getPointer(opt.e);
      canvas.zoomToPoint(new fabric.Point(pointer.x, pointer.y), newZoom);

      setZoomState(newZoom);

      e.preventDefault();
      e.stopPropagation();
    };

    canvas.on("mouse:wheel", handleMouseWheel);

    return () => {
      canvas.off("mouse:wheel", handleMouseWheel);
    };
  }, [canvas, enableMouseWheel, minZoom, maxZoom]);

  const setZoom = useCallback(
    (level: number) => {
      if (!canvas) return;

      const constrainedZoom = Math.max(minZoom, Math.min(maxZoom, level));
      canvas.setZoom(constrainedZoom);
      setZoomState(constrainedZoom);
      canvas.renderAll();
    },
    [canvas, minZoom, maxZoom]
  );

  const zoomIn = useCallback(() => {
    const newZoom = zoom + step;
    setZoom(newZoom);
  }, [zoom, step, setZoom]);

  const zoomOut = useCallback(() => {
    const newZoom = zoom - step;
    setZoom(newZoom);
  }, [zoom, step, setZoom]);

  const zoomToPoint = useCallback(
    (point: Point, level: number) => {
      if (!canvas) return;

      const constrainedZoom = Math.max(minZoom, Math.min(maxZoom, level));
      canvas.zoomToPoint(new fabric.Point(point.x, point.y), constrainedZoom);
      setZoomState(constrainedZoom);
    },
    [canvas, minZoom, maxZoom]
  );

  const zoomToFit = useCallback(() => {
    if (!canvas) return;

    const objects = canvas.getObjects();
    if (objects.length === 0) return;

    const group = new fabric.Group(objects);
    const groupWidth = group.width || 0;
    const groupHeight = group.height || 0;

    const canvasWidth = canvas.width || 0;
    const canvasHeight = canvas.height || 0;

    const newZoom = Math.min(
      canvasWidth / groupWidth,
      canvasHeight / groupHeight
    ) * 0.9;

    setZoom(newZoom);

    // Center the content
    const center = group.getCenterPoint();
    const vpt = canvas.viewportTransform;
    if (vpt) {
      vpt[4] = canvasWidth / 2 - center.x * newZoom;
      vpt[5] = canvasHeight / 2 - center.y * newZoom;
    }

    group.destroy();
    canvas.renderAll();
  }, [canvas, setZoom]);

  const resetZoom = useCallback(() => {
    setZoom(1);
  }, [setZoom]);

  return {
    zoom,
    setZoom,
    zoomIn,
    zoomOut,
    zoomToFit,
    zoomToPoint,
    resetZoom,
  };
}
