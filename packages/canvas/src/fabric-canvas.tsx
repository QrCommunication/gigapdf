/**
 * Main React component wrapping Fabric.js canvas for PDF editing
 */

import React, { useEffect, useImperativeHandle, forwardRef } from "react";
import type { PageObject, Element, Tool } from "@giga-pdf/types";
import { useCanvas, useCanvasEvents, useSelection, useZoom } from "./hooks";
import { PDFText } from "./objects/pdf-text";
import { PDFImage } from "./objects/pdf-image";
import { PDFShape } from "./objects/pdf-shape";
import { PDFAnnotation } from "./objects/pdf-annotation";
import { SelectTool } from "./tools/select-tool";
import { TextTool } from "./tools/text-tool";
import { DrawTool } from "./tools/draw-tool";
import { ShapeTool } from "./tools/shape-tool";
import { AnnotationTool } from "./tools/annotation-tool";
import { PanTool } from "./tools/pan-tool";
import { ZoomTool } from "./tools/zoom-tool";

export interface FabricCanvasProps {
  pages?: PageObject[];
  width?: number;
  height?: number;
  backgroundColor?: string;
  tool?: Tool;
  enableZoom?: boolean;
  enablePan?: boolean;
  onObjectAdded?: (obj: any) => void;
  onObjectModified?: (obj: any) => void;
  onObjectRemoved?: (obj: any) => void;
  onSelectionChanged?: (objects: any[]) => void;
  className?: string;
}

export interface FabricCanvasRef {
  canvas: any;
  getCanvas: () => any;
  renderPage: (page: PageObject) => Promise<void>;
  renderElements: (elements: Element[]) => Promise<void>;
  addElement: (element: Element) => Promise<any>;
  removeElement: (elementId: string) => void;
  clearCanvas: () => void;
  exportToDataURL: (format?: string) => string;
  exportToBlob: (format?: string) => Promise<Blob>;
  getSelectedObjects: () => any[];
  selectObject: (obj: any) => void;
  clearSelection: () => void;
  zoom: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  resetZoom: () => void;
}

/**
 * FabricCanvas component
 */
export const FabricCanvas = forwardRef<FabricCanvasRef, FabricCanvasProps>(
  (props, ref) => {
    const {
      pages = [],
      width = 800,
      height = 600,
      backgroundColor = "#f5f5f5",
      tool = "select",
      enableZoom = true,
      enablePan = false,
      onObjectAdded,
      onObjectModified,
      onObjectRemoved,
      onSelectionChanged,
      className = "",
    } = props;

    const { canvasRef, canvas, isReady } = useCanvas({
      width,
      height,
      backgroundColor,
    });

    const selection = useSelection(canvas);
    const {
      selectedObjects,
      selectObject: selectObjectHook,
      clearSelection: clearSelectionHook,
    } = selection || { selectedObjects: [], selectObject: () => {}, clearSelection: () => {} };

    const zoom = useZoom(canvas, {
      enableMouseWheel: enableZoom,
    });
    const {
      setZoom,
      zoomIn: zoomInHook,
      zoomOut: zoomOutHook,
      zoomToFit: zoomToFitHook,
      resetZoom: resetZoomHook,
    } = zoom || { setZoom: () => {}, zoomIn: () => {}, zoomOut: () => {}, zoomToFit: () => {}, resetZoom: () => {} };

    // Tools — initialized in useEffect once canvas is ready (cannot use useState here
    // because canvas is null during first render, causing all tools to stay null forever)
    const selectToolRef = React.useRef<SelectTool | null>(null);
    const textToolRef = React.useRef<TextTool | null>(null);
    const drawToolRef = React.useRef<DrawTool | null>(null);
    const shapeToolRef = React.useRef<ShapeTool | null>(null);
    const annotationToolRef = React.useRef<AnnotationTool | null>(null);
    const panToolRef = React.useRef<PanTool | null>(null);
    const zoomToolRef = React.useRef<ZoomTool | null>(null);

    // Initialize tools once the Fabric.js canvas instance is available
    useEffect(() => {
      if (!canvas) return;
      selectToolRef.current = new SelectTool(canvas);
      textToolRef.current = new TextTool(canvas);
      drawToolRef.current = new DrawTool(canvas);
      shapeToolRef.current = new ShapeTool(canvas);
      annotationToolRef.current = new AnnotationTool(canvas);
      panToolRef.current = new PanTool(canvas);
      zoomToolRef.current = new ZoomTool(canvas);
      return () => {
        selectToolRef.current?.deactivate();
        textToolRef.current?.deactivate();
        drawToolRef.current?.deactivate();
        shapeToolRef.current?.deactivate();
        annotationToolRef.current?.deactivate();
        panToolRef.current?.deactivate();
        zoomToolRef.current?.deactivate();
      };
    }, [canvas]);

    // Canvas events
    useCanvasEvents(canvas, {
      onObjectAdded: (e) => {
        if (e.target && onObjectAdded) {
          onObjectAdded(e.target);
        }
      },
      onObjectModified: (e) => {
        if (e.target && onObjectModified) {
          onObjectModified(e.target);
        }
      },
      onObjectRemoved: (e) => {
        if (e.target && onObjectRemoved) {
          onObjectRemoved(e.target);
        }
      },
    });

    // Selection change event
    useEffect(() => {
      if (onSelectionChanged) {
        onSelectionChanged(selectedObjects);
      }
    }, [selectedObjects, onSelectionChanged]);

    // Tool activation — use refs so this effect doesn't re-run when tools are re-created
    useEffect(() => {
      if (!canvas) return;

      // Deactivate all tools
      selectToolRef.current?.deactivate();
      textToolRef.current?.deactivate();
      drawToolRef.current?.deactivate();
      shapeToolRef.current?.deactivate();
      annotationToolRef.current?.deactivate();
      panToolRef.current?.deactivate();
      zoomToolRef.current?.deactivate();

      // Activate selected tool
      switch (tool) {
        case "select":
          selectToolRef.current?.activate();
          break;
        case "text":
          textToolRef.current?.activate();
          break;
        case "hand":
          if (enablePan) panToolRef.current?.activate();
          break;
        case "zoom":
          if (enableZoom) zoomToolRef.current?.activate();
          break;
        default:
          selectToolRef.current?.activate();
      }
    }, [canvas, tool, enablePan, enableZoom]);

    // Render pages
    useEffect(() => {
      if (!canvas || !isReady || pages.length === 0) return;

      const renderPages = async () => {
        for (const page of pages) {
          await renderPageElements(page);
        }
      };

      renderPages();
    }, [canvas, isReady, pages]);

    // Render page elements
    const renderPageElements = async (page: PageObject) => {
      if (!canvas) return;

      for (const element of page.elements) {
        await addElement(element);
      }
    };

    // Add element to canvas
    const addElement = async (element: Element): Promise<any> => {
      if (!canvas) return null;

      try {
        let obj: any = null;

        switch (element.type) {
          case "text":
            obj = PDFText.fromElement(element);
            break;

          case "image":
            obj = await PDFImage.fromElement(element);
            break;

          case "shape":
            obj = PDFShape.fromElement(element);
            break;

          case "annotation":
            obj = PDFAnnotation.fromElement(element);
            break;

          default:
            console.warn(`Unsupported element type: ${element.type}`);
            return null;
        }

        if (obj) {
          canvas.add(obj);
          canvas.renderAll();
        }

        return obj;
      } catch (error) {
        console.error("Failed to add element:", error);
        return null;
      }
    };

    // Remove element from canvas
    const removeElement = (elementId: string) => {
      if (!canvas) return;

      const objects = canvas.getObjects();
      const obj = objects.find((o: any) => o.data?.elementId === elementId);

      if (obj) {
        canvas.remove(obj);
        canvas.renderAll();
      }
    };

    // Clear canvas
    const clearCanvas = () => {
      if (!canvas) return;
      canvas.clear();
      canvas.renderAll();
    };

    // Export to data URL
    const exportToDataURL = (_format: string = "png"): string => {
      if (!canvas) return "";
      return canvas.toDataURL();
    };

    // Export to Blob
    const exportToBlob = async (format: string = "png"): Promise<Blob> => {
      const dataURL = exportToDataURL(format);
      const response = await fetch(dataURL);
      return response.blob();
    };

    // Render a single page
    const renderPage = async (page: PageObject) => {
      await renderPageElements(page);
    };

    // Render multiple elements
    const renderElements = async (elements: Element[]) => {
      for (const element of elements) {
        await addElement(element);
      }
    };

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      canvas,
      getCanvas: () => canvas,
      renderPage,
      renderElements,
      addElement,
      removeElement,
      clearCanvas,
      exportToDataURL,
      exportToBlob,
      getSelectedObjects: () => selectedObjects,
      selectObject: selectObjectHook,
      clearSelection: clearSelectionHook,
      zoom: setZoom,
      zoomIn: zoomInHook,
      zoomOut: zoomOutHook,
      zoomToFit: zoomToFitHook,
      resetZoom: resetZoomHook,
    }));

    return (
      <div className={`fabric-canvas-container ${className}`}>
        <canvas ref={canvasRef} />
      </div>
    );
  }
);

FabricCanvas.displayName = "FabricCanvas";
