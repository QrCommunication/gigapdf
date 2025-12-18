"use client";

import React, { useRef, useEffect } from "react";
import type { PageObject, Tool, Element } from "@giga-pdf/types";

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
}

/**
 * Wrapper du canvas Fabric.js pour l'éditeur PDF.
 */
export function EditorCanvas({
  page,
  tool,
  zoom,
  width = 800,
  height = 600,
  onElementAdded,
  onElementModified,
  onElementRemoved,
  onSelectionChanged,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const previousPageRef = useRef<string | null>(null);

  // Charger la page quand elle change
  useEffect(() => {
    if (!canvasRef.current || !page) return;

    // Éviter de recharger la même page
    if (previousPageRef.current === page.pageId) return;
    previousPageRef.current = page.pageId;

    // TODO: Intégrer avec le canvas Fabric.js une fois le package configuré
    console.log("Page changed:", page.pageId);
  }, [page]);

  // Appliquer le zoom
  useEffect(() => {
    // TODO: Appliquer le zoom au canvas
    console.log("Zoom changed:", zoom);
  }, [zoom]);

  // Placeholder handlers - seront connectés au canvas Fabric.js
  useEffect(() => {
    // Log pour débogage - les handlers seront connectés plus tard
    console.log("Canvas handlers ready:", {
      hasAddHandler: !!onElementAdded,
      hasModifyHandler: !!onElementModified,
      hasRemoveHandler: !!onElementRemoved,
      hasSelectionHandler: !!onSelectionChanged,
    });
  }, [onElementAdded, onElementModified, onElementRemoved, onSelectionChanged]);

  // Calculer les dimensions du canvas basées sur la page
  const canvasWidth = page?.dimensions?.width || width;
  const canvasHeight = page?.dimensions?.height || height;

  return (
    <div className="editor-canvas-wrapper h-full w-full flex items-center justify-center bg-gray-100 dark:bg-gray-900 overflow-auto p-8">
      <div
        ref={canvasRef}
        className="canvas-container bg-white shadow-lg rounded-sm"
        style={{
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
          minWidth: canvasWidth * zoom,
          minHeight: canvasHeight * zoom,
        }}
      >
        {/* Placeholder pour le canvas PDF */}
        {page ? (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            {page.preview?.thumbnailUrl ? (
              <img
                src={`${process.env.NEXT_PUBLIC_API_URL || ""}${page.preview.thumbnailUrl}`}
                alt={`Page ${page.pageNumber}`}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-center">
                <p className="text-lg font-medium">Page {page.pageNumber}</p>
                <p className="text-sm">{canvasWidth} x {canvasHeight} px</p>
                <p className="text-xs mt-2">Outil actif: {tool}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <p>Aucune page à afficher</p>
          </div>
        )}
      </div>
    </div>
  );
}
