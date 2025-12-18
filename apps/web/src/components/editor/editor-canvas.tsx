"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import type {
  PageObject,
  Tool,
  Element,
  ShapeType,
  AnnotationType,
} from "@giga-pdf/types";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";

export interface EditorCanvasHandle {
  /** Ajouter une image au canvas */
  addImage: (dataUrl: string, width: number, height: number) => void;
  /** Annuler la dernière action */
  undo: () => void;
  /** Refaire la dernière action annulée */
  redo: () => void;
  /** Peut annuler */
  canUndo: () => boolean;
  /** Peut refaire */
  canRedo: () => boolean;
  /** Supprimer les éléments sélectionnés */
  deleteSelected: () => void;
  /** Dupliquer les éléments sélectionnés */
  duplicateSelected: () => void;
  /** Obtenir les IDs des éléments sélectionnés */
  getSelectedIds: () => string[];
}

export interface EditorCanvasProps {
  /** Page actuelle à afficher */
  page: PageObject | null;
  /** Outil actif */
  tool: Tool;
  /** Niveau de zoom (1 = 100%) */
  zoom: number;
  /** Largeur du canvas */
  width?: number;
  /** Hauteur du canvas */
  height?: number;
  /** Type de forme sélectionné */
  shapeType?: ShapeType;
  /** Type d'annotation sélectionné */
  annotationType?: AnnotationType;
  /** Couleur de contour */
  strokeColor?: string;
  /** Couleur de remplissage */
  fillColor?: string;
  /** Épaisseur du contour */
  strokeWidth?: number;
  /** Callback quand un élément est ajouté */
  onElementAdded?: (element: Element) => void;
  /** Callback quand un élément est modifié */
  onElementModified?: (element: Element) => void;
  /** Callback quand un élément est supprimé */
  onElementRemoved?: (elementId: string) => void;
  /** Callback quand la sélection change */
  onSelectionChanged?: (elementIds: string[]) => void;
  /** Callback pour changement de zoom */
  onZoomChanged?: (zoom: number) => void;
  /** Callback appelé lorsque le canvas est prêt avec les méthodes exposées */
  onCanvasReady?: (handle: EditorCanvasHandle) => void;
}

// Génère un ID unique
function generateId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Type helper for fabric objects with custom data
interface FabricObjectWithData extends FabricObject {
  data?: { elementId?: string; [key: string]: unknown };
}

/**
 * Canvas de l'éditeur PDF avec support Fabric.js.
 * Chaque élément est indépendant et éditable.
 */
export function EditorCanvas({
  page,
  tool,
  zoom,
  width = 800,
  height = 600,
  shapeType = "rectangle",
  annotationType = "highlight",
  strokeColor = "#000000",
  fillColor = "transparent",
  strokeWidth = 2,
  onElementAdded,
  onElementModified,
  onElementRemoved,
  onSelectionChanged,
  onZoomChanged,
  onCanvasReady,
}: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const previousPageRef = useRef<string | null>(null);

  // Historique pour undo/redo
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isUpdatingHistory, setIsUpdatingHistory] = useState(false);

  // Sauvegarder l'état dans l'historique
  const saveHistory = useCallback(
    (canvas: FabricCanvas) => {
      const json = JSON.stringify(canvas.toObject(["data"]));
      setHistoryStack((prev) => {
        const newStack = prev.slice(0, historyIndex + 1);
        return [...newStack, json];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex]
  );

  // Convertir un objet Fabric.js en Element
  const fabricObjectToElement = useCallback(
    (obj: FabricObjectWithData): Element | null => {
      const elementId = obj.data?.elementId || generateId();
      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;

      // Base element properties matching ElementBase interface
      const baseElement = {
        elementId,
        bounds: {
          x: obj.left || 0,
          y: obj.top || 0,
          width: (obj.width || 100) * scaleX,
          height: (obj.height || 100) * scaleY,
        },
        transform: {
          rotation: obj.angle || 0,
          scaleX: 1, // Already applied to bounds
          scaleY: 1,
          skewX: obj.skewX || 0,
          skewY: obj.skewY || 0,
        },
        layerId: null,
        locked: !obj.selectable,
        visible: obj.visible ?? true,
      };

      // Check object type using constructor name
      const typeName = obj.constructor.name;

      if (typeName === "IText" || typeName === "FabricText" || typeName === "Text") {
        const textObj = obj as FabricObjectWithData & {
          text?: string;
          fontSize?: number;
          fontFamily?: string;
          fontWeight?: string;
          fontStyle?: string;
          fill?: string;
          textAlign?: string;
          lineHeight?: number;
          charSpacing?: number;
        };
        return {
          ...baseElement,
          type: "text" as const,
          content: textObj.text || "",
          style: {
            fontFamily: textObj.fontFamily || "Arial",
            fontSize: textObj.fontSize || 16,
            fontWeight: textObj.fontWeight === "bold" ? "bold" : "normal",
            fontStyle: textObj.fontStyle === "italic" ? "italic" : "normal",
            color: (textObj.fill as string) || "#000000",
            opacity: obj.opacity ?? 1,
            textAlign: (textObj.textAlign as "left" | "center" | "right" | "justify") || "left",
            lineHeight: textObj.lineHeight || 1.2,
            letterSpacing: textObj.charSpacing || 0,
            writingMode: "horizontal-tb" as const,
          },
          ocrConfidence: null,
        };
      }

      if (typeName === "FabricImage" || typeName === "Image") {
        const imgObj = obj as FabricObjectWithData & {
          getSrc?: () => string;
          width?: number;
          height?: number;
          scaleX?: number;
          scaleY?: number;
        };
        return {
          ...baseElement,
          type: "image" as const,
          source: {
            type: "embedded" as const,
            dataUrl: imgObj.getSrc?.() || "",
            originalFormat: "png",
            originalDimensions: {
              width: imgObj.width || 100,
              height: imgObj.height || 100,
            },
          },
          style: {
            opacity: obj.opacity ?? 1,
            blendMode: "normal" as const,
          },
          crop: null,
        };
      }

      if (["Rect", "Circle", "Triangle", "Ellipse", "Line"].includes(typeName)) {
        type ShapeTypeValue = "rectangle" | "ellipse" | "line" | "polygon" | "path";
        let shapeTypeResult: ShapeTypeValue = "rectangle";
        if (typeName === "Circle" || typeName === "Ellipse") shapeTypeResult = "ellipse";
        if (typeName === "Line") shapeTypeResult = "line";
        if (typeName === "Triangle") shapeTypeResult = "polygon";

        return {
          ...baseElement,
          type: "shape" as const,
          shapeType: shapeTypeResult,
          geometry: {
            points: [],
            pathData: null,
            cornerRadius: 0,
          },
          style: {
            fillColor: (obj.fill as string) || null,
            fillOpacity: obj.opacity ?? 1,
            strokeColor: (obj.stroke as string) || null,
            strokeWidth: obj.strokeWidth || 1,
            strokeOpacity: 1,
            strokeDashArray: [],
          },
        };
      }

      return null;
    },
    []
  );

  // Handlers d'événements
  const handleSelectionChange = useCallback(() => {
    if (!fabricRef.current) return;
    const activeObjects = fabricRef.current.getActiveObjects();
    const ids = activeObjects
      .map((obj) => (obj as FabricObjectWithData).data?.elementId)
      .filter(Boolean) as string[];
    onSelectionChanged?.(ids);
  }, [onSelectionChanged]);

  const handleObjectModified = useCallback(
    (e: { target?: FabricObject }) => {
      if (!e.target) return;
      const element = fabricObjectToElement(e.target as FabricObjectWithData);
      if (element) {
        onElementModified?.(element);
      }
      if (fabricRef.current) {
        saveHistory(fabricRef.current);
      }
    },
    [fabricObjectToElement, onElementModified, saveHistory]
  );

  const handleObjectAdded = useCallback(
    (e: { target?: FabricObject }) => {
      if (isUpdatingHistory) return;
      if (!e.target) return;
      const element = fabricObjectToElement(e.target as FabricObjectWithData);
      if (element) {
        onElementAdded?.(element);
      }
    },
    [fabricObjectToElement, onElementAdded, isUpdatingHistory]
  );

  const handleObjectRemoved = useCallback(
    (e: { target?: FabricObject }) => {
      if (isUpdatingHistory) return;
      if (!e.target) return;
      const elementId = (e.target as FabricObjectWithData).data?.elementId;
      if (elementId) {
        onElementRemoved?.(elementId);
      }
    },
    [onElementRemoved, isUpdatingHistory]
  );

  // Initialiser Fabric.js
  useEffect(() => {
    if (!canvasRef.current) return;

    // Import dynamique de Fabric.js pour éviter les erreurs SSR
    import("fabric").then((fabricModule) => {
      const { Canvas, Rect, Circle, Ellipse, Triangle, Line, IText, Group, FabricText } = fabricModule;

      if (fabricRef.current) {
        fabricRef.current.dispose();
      }

      const canvas = new Canvas(canvasRef.current!, {
        width: (page?.dimensions?.width || width) * zoom,
        height: (page?.dimensions?.height || height) * zoom,
        backgroundColor: "#ffffff",
        selection: tool === "select",
        preserveObjectStacking: true,
      });

      fabricRef.current = canvas;

      // Event handlers
      canvas.on("selection:created", handleSelectionChange);
      canvas.on("selection:updated", handleSelectionChange);
      canvas.on("selection:cleared", handleSelectionChange);
      canvas.on("object:modified", handleObjectModified as (e: unknown) => void);
      canvas.on("object:added", handleObjectAdded as (e: unknown) => void);
      canvas.on("object:removed", handleObjectRemoved as (e: unknown) => void);

      // Mouse down for creating objects
      canvas.on("mouse:down", (e) => {
        if (!fabricRef.current || !e.scenePoint) return;
        const currentCanvas = fabricRef.current;

        // Si on clique sur un objet existant, ne rien créer
        if (e.target) return;

        const pointer = e.scenePoint;

        let newObj: FabricObject | null = null;

        switch (tool) {
          case "text": {
            newObj = new IText("Texte", {
              left: pointer.x,
              top: pointer.y,
              fontSize: 16,
              fontFamily: "Arial",
              fill: strokeColor,
            });
            (newObj as FabricObjectWithData).data = { elementId: generateId() };
            break;
          }

          case "shape": {
            const shapeOptions = {
              left: pointer.x,
              top: pointer.y,
              fill: fillColor,
              stroke: strokeColor,
              strokeWidth: strokeWidth,
            };

            switch (shapeType) {
              case "rectangle":
                newObj = new Rect({
                  ...shapeOptions,
                  width: 100,
                  height: 80,
                });
                break;
              case "circle":
                newObj = new Circle({
                  ...shapeOptions,
                  radius: 50,
                });
                break;
              case "ellipse":
                newObj = new Ellipse({
                  ...shapeOptions,
                  rx: 60,
                  ry: 40,
                });
                break;
              case "triangle":
                newObj = new Triangle({
                  ...shapeOptions,
                  width: 100,
                  height: 100,
                });
                break;
              case "line":
              case "arrow":
                newObj = new Line([0, 0, 100, 0], shapeOptions);
                break;
            }
            if (newObj) {
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
            }
            break;
          }

          case "annotation": {
            switch (annotationType) {
              case "highlight":
                newObj = new Rect({
                  left: pointer.x,
                  top: pointer.y,
                  width: 100,
                  height: 20,
                  fill: "rgba(255, 255, 0, 0.3)",
                  stroke: "transparent",
                });
                break;
              case "underline":
                newObj = new Line([0, 0, 100, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: "#ff0000",
                  strokeWidth: 2,
                });
                break;
              case "strikethrough":
                newObj = new Line([0, 0, 100, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: "#ff0000",
                  strokeWidth: 1,
                });
                break;
              case "note":
                newObj = new Rect({
                  left: pointer.x,
                  top: pointer.y,
                  width: 30,
                  height: 30,
                  fill: "#ffeb3b",
                  stroke: "#ffc107",
                  strokeWidth: 1,
                });
                break;
              case "comment":
                newObj = new Circle({
                  left: pointer.x,
                  top: pointer.y,
                  radius: 15,
                  fill: "#2196f3",
                  stroke: "#1976d2",
                  strokeWidth: 1,
                });
                break;
            }
            if (newObj) {
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
            }
            break;
          }

          case "form_field": {
            // Créer un champ de formulaire (text input)
            const formFieldGroup = new Group(
              [
                // Fond du champ
                new Rect({
                  left: 0,
                  top: 0,
                  width: 200,
                  height: 30,
                  fill: "#ffffff",
                  stroke: "#cccccc",
                  strokeWidth: 1,
                  rx: 4,
                  ry: 4,
                }),
                // Texte placeholder
                new FabricText("Champ de texte", {
                  left: 10,
                  top: 8,
                  fontSize: 12,
                  fontFamily: "Arial",
                  fill: "#999999",
                }),
              ],
              {
                left: pointer.x,
                top: pointer.y,
              }
            );
            (formFieldGroup as FabricObjectWithData).data = {
              elementId: generateId(),
              formFieldType: "text",
              fieldName: `field_${Date.now()}`,
              required: false,
              placeholder: "Champ de texte",
            };
            newObj = formFieldGroup;
            break;
          }
        }

        if (newObj) {
          currentCanvas.add(newObj);
          currentCanvas.setActiveObject(newObj);
          currentCanvas.renderAll();
          saveHistory(currentCanvas);
        }
      });

      // Mouse wheel for zoom
      canvas.on("mouse:wheel", (opt) => {
        const event = opt.e as WheelEvent;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.1 : 0.1;
          const newZoom = Math.min(4, Math.max(0.25, zoom + delta));
          onZoomChanged?.(newZoom);
        }
      });

      // Charger la page initiale
      if (page && page.elements) {
        page.elements.forEach((element) => {
          const obj = elementToFabricObject(element, fabricModule);
          if (obj) {
            (obj as FabricObjectWithData).data = { elementId: element.elementId };
            canvas.add(obj);
          }
        });
        canvas.renderAll();
      }

      // Sauvegarder l'état initial
      saveHistory(canvas);
    });

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convertir un Element en objet Fabric.js
  const elementToFabricObject = (
    element: Element,
    fabricModule: typeof import("fabric")
  ): FabricObject | null => {
    const { Rect, Circle, Ellipse, Triangle, Line, IText, FabricImage } = fabricModule;

    const baseOptions = {
      left: element.position.x,
      top: element.position.y,
      angle: element.position.rotation || 0,
      opacity: element.style?.opacity ?? 1,
      selectable: !element.locked,
    };

    switch (element.type) {
      case "text": {
        const textEl = element as Element & {
          content: { text: string; fontSize: number; fontFamily: string };
        };
        return new IText(textEl.content?.text || "Text", {
          ...baseOptions,
          fontSize: textEl.content?.fontSize || 16,
          fontFamily: textEl.content?.fontFamily || "Arial",
          fill: element.style?.fillColor || "#000000",
        });
      }

      case "image": {
        // Les images seront chargées de manière asynchrone
        const imgEl = element as Element & {
          content: { src: string; width: number; height: number };
        };
        if (imgEl.content?.src) {
          FabricImage.fromURL(imgEl.content.src).then((img: FabricObject) => {
            img.set({
              ...baseOptions,
              scaleX: (imgEl.content?.width || 100) / ((img as unknown as { width: number }).width || 100),
              scaleY: (imgEl.content?.height || 100) / ((img as unknown as { height: number }).height || 100),
            });
            (img as FabricObjectWithData).data = { elementId: element.elementId };
            fabricRef.current?.add(img);
            fabricRef.current?.renderAll();
          });
        }
        return null;
      }

      case "shape": {
        const shapeEl = element as Element & {
          content: { shapeType: ShapeType; width: number; height: number };
        };
        const shapeOptions = {
          ...baseOptions,
          fill: element.style?.fillColor || "transparent",
          stroke: element.style?.strokeColor || "#000000",
          strokeWidth: element.style?.strokeWidth || 2,
        };

        switch (shapeEl.content?.shapeType) {
          case "rectangle":
            return new Rect({
              ...shapeOptions,
              width: shapeEl.content?.width || 100,
              height: shapeEl.content?.height || 100,
            });
          case "circle":
            return new Circle({
              ...shapeOptions,
              radius: (shapeEl.content?.width || 100) / 2,
            });
          case "ellipse":
            return new Ellipse({
              ...shapeOptions,
              rx: (shapeEl.content?.width || 100) / 2,
              ry: (shapeEl.content?.height || 50) / 2,
            });
          case "line":
          case "arrow":
            return new Line(
              [0, 0, shapeEl.content?.width || 100, 0],
              shapeOptions
            );
          case "triangle":
            return new Triangle({
              ...shapeOptions,
              width: shapeEl.content?.width || 100,
              height: shapeEl.content?.height || 100,
            });
          default:
            return new Rect({
              ...shapeOptions,
              width: 100,
              height: 100,
            });
        }
      }

      case "annotation": {
        const annoEl = element as Element & {
          content: {
            annotationType: AnnotationType;
            width: number;
            height: number;
          };
        };
        switch (annoEl.content?.annotationType) {
          case "highlight":
            return new Rect({
              ...baseOptions,
              width: annoEl.content?.width || 100,
              height: annoEl.content?.height || 20,
              fill: "rgba(255, 255, 0, 0.3)",
              stroke: "transparent",
            });
          case "underline":
            return new Line(
              [0, 0, annoEl.content?.width || 100, 0],
              {
                ...baseOptions,
                stroke: "#ff0000",
                strokeWidth: 2,
              }
            );
          case "strikethrough":
            return new Line(
              [0, 0, annoEl.content?.width || 100, 0],
              {
                ...baseOptions,
                stroke: "#ff0000",
                strokeWidth: 1,
              }
            );
          case "note":
            return new Rect({
              ...baseOptions,
              width: 30,
              height: 30,
              fill: "#ffeb3b",
              stroke: "#ffc107",
              strokeWidth: 1,
            });
          case "comment":
            return new Circle({
              ...baseOptions,
              radius: 15,
              fill: "#2196f3",
              stroke: "#1976d2",
              strokeWidth: 1,
            });
          default:
            return new Rect({
              ...baseOptions,
              width: 100,
              height: 20,
              fill: "rgba(255, 255, 0, 0.3)",
            });
        }
      }

      default:
        return null;
    }
  };

  // Charger une page dans le canvas
  const loadPage = useCallback(
    (pageData: PageObject, fabricModule: typeof import("fabric")) => {
      if (!fabricRef.current) return;
      const canvas = fabricRef.current;

      // Nettoyer le canvas
      canvas.clear();
      canvas.backgroundColor = "#ffffff";

      // Charger chaque élément de la page
      pageData.elements.forEach((element) => {
        const obj = elementToFabricObject(element, fabricModule);
        if (obj) {
          (obj as FabricObjectWithData).data = { elementId: element.elementId };
          canvas.add(obj);
        }
      });

      canvas.renderAll();
    },
    []
  );

  // Mettre à jour la page quand elle change
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    if (previousPageRef.current === page.pageId) return;
    previousPageRef.current = page.pageId;

    import("fabric").then((fabricModule) => {
      loadPage(page, fabricModule);
    });
  }, [page, loadPage]);

  // Mettre à jour le zoom
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    const canvas = fabricRef.current;
    canvas.setZoom(zoom);
    canvas.setDimensions({
      width: (page.dimensions?.width || width) * zoom,
      height: (page.dimensions?.height || height) * zoom,
    });
    canvas.renderAll();
  }, [zoom, page, width, height]);

  // Mettre à jour les options de l'outil
  useEffect(() => {
    if (!fabricRef.current) return;
    fabricRef.current.selection = tool === "select";
    fabricRef.current.defaultCursor =
      tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
    fabricRef.current.renderAll();
  }, [tool]);

  // Exposer les méthodes via callback
  useEffect(() => {
    if (!onCanvasReady) return;

    const handle: EditorCanvasHandle = {
      addImage: (dataUrl: string) => {
        if (!fabricRef.current) return;
        import("fabric").then(({ FabricImage }) => {
          FabricImage.fromURL(dataUrl).then((img) => {
            img.set({
              left: 50,
              top: 50,
              scaleX: Math.min(1, 400 / ((img as unknown as { width: number }).width || 400)),
              scaleY: Math.min(1, 400 / ((img as unknown as { height: number }).height || 400)),
            });
            (img as FabricObjectWithData).data = { elementId: generateId() };
            fabricRef.current?.add(img);
            fabricRef.current?.setActiveObject(img);
            fabricRef.current?.renderAll();
            if (fabricRef.current) {
              saveHistory(fabricRef.current);
            }
          });
        });
      },
      undo: () => {
        if (historyIndex <= 0 || !fabricRef.current) return;
        setIsUpdatingHistory(true);
        const newIndex = historyIndex - 1;
        const json = historyStack[newIndex];
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          setIsUpdatingHistory(false);
        });
      },
      redo: () => {
        if (historyIndex >= historyStack.length - 1 || !fabricRef.current)
          return;
        setIsUpdatingHistory(true);
        const newIndex = historyIndex + 1;
        const json = historyStack[newIndex];
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          setIsUpdatingHistory(false);
        });
      },
      canUndo: () => historyIndex > 0,
      canRedo: () => historyIndex < historyStack.length - 1,
      deleteSelected: () => {
        if (!fabricRef.current) return;
        const activeObjects = fabricRef.current.getActiveObjects();
        activeObjects.forEach((obj) => {
          fabricRef.current?.remove(obj);
        });
        fabricRef.current.discardActiveObject();
        fabricRef.current.renderAll();
        saveHistory(fabricRef.current);
      },
      duplicateSelected: () => {
        if (!fabricRef.current) return;
        const activeObjects = fabricRef.current.getActiveObjects();
        fabricRef.current.discardActiveObject();
        activeObjects.forEach((obj) => {
          obj.clone().then((cloned: FabricObject) => {
            cloned.set({
              left: (cloned.left || 0) + 20,
              top: (cloned.top || 0) + 20,
            });
            (cloned as FabricObjectWithData).data = { elementId: generateId() };
            fabricRef.current?.add(cloned);
          });
        });
        fabricRef.current.renderAll();
        if (fabricRef.current) {
          saveHistory(fabricRef.current);
        }
      },
      getSelectedIds: () => {
        if (!fabricRef.current) return [];
        return fabricRef.current
          .getActiveObjects()
          .map((obj) => (obj as FabricObjectWithData).data?.elementId)
          .filter(Boolean) as string[];
      },
    };

    onCanvasReady(handle);
  }, [historyIndex, historyStack, saveHistory, onCanvasReady]);

  // Calculer les dimensions du canvas basées sur la page
  const canvasWidth = page?.dimensions?.width || width;
  const canvasHeight = page?.dimensions?.height || height;

  return (
    <div className="editor-canvas-wrapper h-full w-full flex items-center justify-center bg-gray-100 dark:bg-gray-900 overflow-auto p-8">
      <div
        ref={containerRef}
        className="canvas-container bg-white shadow-lg rounded-sm"
        style={{
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
          minWidth: canvasWidth * zoom,
          minHeight: canvasHeight * zoom,
        }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
