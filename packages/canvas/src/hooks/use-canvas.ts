/**
 * React hook for managing Fabric.js canvas
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as fabric from "fabric";

export interface UseCanvasOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  selection?: boolean;
}

export interface UseCanvasReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  canvas: fabric.Canvas | null;
  isReady: boolean;
}

/**
 * Hook for creating and managing a Fabric.js canvas
 */
export function useCanvas(options: UseCanvasOptions = {}): UseCanvasReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    const fabricCanvas = new fabric.Canvas(canvasRef.current, {
      width: options.width || 800,
      height: options.height || 600,
      backgroundColor: options.backgroundColor || "#ffffff",
      selection: options.selection !== undefined ? options.selection : true,
      preserveObjectStacking: true,
    });

    setCanvas(fabricCanvas);
    setIsReady(true);

    return () => {
      fabricCanvas.dispose();
      setCanvas(null);
      setIsReady(false);
    };
  }, []);

  // Update canvas options when they change
  useEffect(() => {
    if (!canvas) return;

    if (options.width !== undefined) {
      canvas.setWidth(options.width);
    }
    if (options.height !== undefined) {
      canvas.setHeight(options.height);
    }
    if (options.backgroundColor !== undefined) {
      (canvas as any).backgroundColor = options.backgroundColor;
      canvas.renderAll();
    }
    if (options.selection !== undefined) {
      canvas.selection = options.selection;
    }
  }, [canvas, options.width, options.height, options.backgroundColor, options.selection]);

  return {
    canvasRef,
    canvas,
    isReady,
  };
}

/**
 * Hook for managing canvas dimensions
 */
export function useCanvasDimensions(canvas: fabric.Canvas | null) {
  const [dimensions, setDimensionsState] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!canvas) return;

    const updateDimensions = () => {
      setDimensionsState({
        width: canvas.width || 0,
        height: canvas.height || 0,
      });
    };

    updateDimensions();

    // Listen for canvas resize
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (canvas.lowerCanvasEl) {
      resizeObserver.observe(canvas.lowerCanvasEl);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [canvas]);

  const setDimensions = useCallback(
    (width: number, height: number) => {
      if (!canvas) return;

      canvas.setWidth(width);
      canvas.setHeight(height);
      canvas.renderAll();
    },
    [canvas]
  );

  return {
    dimensions,
    setDimensions,
  };
}

/**
 * Hook for managing canvas objects
 */
export function useCanvasObjects(canvas: fabric.Canvas | null) {
  const [objects, setObjects] = useState<fabric.Object[]>([]);

  useEffect(() => {
    if (!canvas) return;

    const updateObjects = () => {
      setObjects([...canvas.getObjects()]);
    };

    updateObjects();

    // Listen for object changes
    canvas.on("object:added", updateObjects);
    canvas.on("object:removed", updateObjects);
    canvas.on("object:modified", updateObjects);

    return () => {
      canvas.off("object:added", updateObjects);
      canvas.off("object:removed", updateObjects);
      canvas.off("object:modified", updateObjects);
    };
  }, [canvas]);

  const addObject = useCallback(
    (obj: fabric.Object) => {
      if (!canvas) return;
      canvas.add(obj);
      canvas.renderAll();
    },
    [canvas]
  );

  const removeObject = useCallback(
    (obj: fabric.Object) => {
      if (!canvas) return;
      canvas.remove(obj);
      canvas.renderAll();
    },
    [canvas]
  );

  const clearObjects = useCallback(() => {
    if (!canvas) return;
    canvas.clear();
    canvas.renderAll();
  }, [canvas]);

  return {
    objects,
    addObject,
    removeObject,
    clearObjects,
  };
}

/**
 * Hook for managing canvas background
 */
export function useCanvasBackground(canvas: fabric.Canvas | null) {
  const [backgroundColor, setBackgroundColorState] = useState<string>("#ffffff");
  const [backgroundImage, setBackgroundImageState] = useState<any>(null);

  const setBackgroundColor = useCallback(
    (color: string) => {
      if (!canvas) return;

      (canvas as any).backgroundColor = color;
      canvas.renderAll();
      setBackgroundColorState(color);
    },
    [canvas]
  );

  const setBackgroundImage = useCallback(
    async (imageUrl: string) => {
      if (!canvas) return;

      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          (canvas as any).backgroundImage = img;
          canvas.renderAll();
          setBackgroundImageState(img);
          resolve();
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = imageUrl;
      });
    },
    [canvas]
  );

  const clearBackground = useCallback(() => {
    if (!canvas) return;

    (canvas as any).backgroundImage = null;
    canvas.renderAll();
    setBackgroundImageState(null);
  }, [canvas]);

  return {
    backgroundColor,
    backgroundImage,
    setBackgroundColor,
    setBackgroundImage,
    clearBackground,
  };
}
