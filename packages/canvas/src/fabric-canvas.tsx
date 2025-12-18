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

    // Tools
    const [selectTool] = React.useState(() => canvas ? new SelectTool(canvas) : null);
    const [textTool] = React.useState(() => canvas ? new TextTool(canvas) : null);
    const [drawTool] = React.useState(() => canvas ? new DrawTool(canvas) : null);
    const [shapeTool] = React.useState(() => canvas ? new ShapeTool(canvas) : null);
    const [annotationTool] = React.useState(() => canvas ? new AnnotationTool(canvas) : null);
    const [panTool] = React.useState(() => canvas ? new PanTool(canvas) : null);
    const [zoomTool] = React.useState(() => canvas ? new ZoomTool(canvas) : null);

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

    // Tool activation
    useEffect(() => {
      if (!canvas) return;

      // Deactivate all tools
      selectTool?.deactivate();
      textTool?.deactivate();
      drawTool?.deactivate();
      shapeTool?.deactivate();
      annotationTool?.deactivate();
      panTool?.deactivate();
      zoomTool?.deactivate();

      // Activate selected tool
      switch (tool) {
        case "select":
          selectTool?.activate();
          break;
        case "text":
          textTool?.activate();
          break;
        case "hand":
          if (enablePan) panTool?.activate();
          break;
        case "zoom":
          if (enableZoom) zoomTool?.activate();
          break;
        default:
          selectTool?.activate();
      }
    }, [canvas, tool, selectTool, textTool, drawTool, shapeTool, annotationTool, panTool, zoomTool, enablePan, enableZoom]);

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
      const obj = objects.find((o: any) => o.elementId === elementId);

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
