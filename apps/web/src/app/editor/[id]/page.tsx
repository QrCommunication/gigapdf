"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import Link from "next/link";
import type { Element } from "@giga-pdf/types";
import { Button } from "@giga-pdf/ui";
import {
  useCanvasStore,
  useSelectionStore,
  useUIStore,
} from "@giga-pdf/editor";
import {
  ArrowLeft,
  Save,
  Download,
  Users,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
  Pencil,
  Check,
  X,
} from "lucide-react";

import { useDocument } from "@/hooks/use-document";
import { useDocumentSave } from "@/hooks/use-document-save";
import { useCollaboration } from "@/hooks/use-collaboration";
import { usePageThumbnails } from "@/hooks/use-page-thumbnails";
import { api, type ElementCreateRequest } from "@/lib/api";
import {
  EditorCanvas,
  EditorToolbar,
  PagesSidebar,
  PropertiesPanel,
  CollaborationOverlay,
  CollaboratorsList,
  DocumentInfoSidebar,
} from "@/components/editor";
import type { EditorCanvasHandle } from "@/components/editor/editor-canvas";
import { FormsPanel } from "@/components/editor/forms-panel";
import { useFlattenPdf, usePdfPageOperation, downloadBlob, useApplyElements } from "@giga-pdf/api";
import { ContentEditLayer, type ElementModification } from "@/components/editor/content-edit-layer";
import { clientLogger } from "@/lib/client-logger";

/**
 * Convert a frontend Element to API ElementCreateRequest format.
 * The API expects snake_case for some fields.
 */
function convertToApiElement(element: Element): ElementCreateRequest {
  const base: ElementCreateRequest = {
    type: element.type,
    bounds: {
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
    },
  };

  // Add transform if present
  if (element.transform) {
    base.transform = {
      rotation: element.transform.rotation,
      scaleX: element.transform.scaleX,
      scaleY: element.transform.scaleY,
      skewX: element.transform.skewX,
      skewY: element.transform.skewY,
    };
  }

  // Add layer_id if present
  if (element.layerId) {
    base.layer_id = element.layerId;
  }

  // Handle type-specific fields
  switch (element.type) {
    case "text":
      base.content = element.content;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "shape":
      base.shape_type = element.shapeType;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "annotation":
      base.annotation_type = element.annotationType;
      base.content = element.content;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "form_field":
      base.field_type = element.fieldType;
      base.field_name = element.fieldName;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "image":
      // Images are handled separately with upload
      base.style = element.style as unknown as Record<string, unknown>;
      break;
  }

  return base;
}

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations("editor");

  // ID du document stocké (depuis l'URL)
  const storedDocumentId = params?.id as string;

  // Canvas store — tool, zoom, tool options
  const {
    activeTool,
    zoom,
    shapeType,
    annotationType,
    strokeColor,
    fillColor,
    strokeWidth,
    setActiveTool,
    setZoom,
    setShapeType,
    setAnnotationType,
    setStrokeColor,
    setFillColor,
    setStrokeWidth,
  } = useCanvasStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      zoom: s.zoom,
      shapeType: s.shapeType,
      annotationType: s.annotationType,
      strokeColor: s.strokeColor,
      fillColor: s.fillColor,
      strokeWidth: s.strokeWidth,
      setActiveTool: s.setActiveTool,
      setZoom: s.setZoom,
      setShapeType: s.setShapeType,
      setAnnotationType: s.setAnnotationType,
      setStrokeColor: s.setStrokeColor,
      setFillColor: s.setFillColor,
      setStrokeWidth: s.setStrokeWidth,
    }))
  );

  // Selection store — selected element ids
  const {
    selectedElementIds: selectedElementIdsSet,
    selectElements,
    clearSelection,
    deselectElement,
  } = useSelectionStore(
    useShallow((s) => ({
      selectedElementIds: s.selectedElementIds,
      selectElements: s.selectElements,
      clearSelection: s.clearSelection,
      deselectElement: s.deselectElement,
    }))
  );
  // Derived: array of selected IDs (compatible with the existing downstream API)
  const selectedElementIds = useMemo(
    () => Array.from(selectedElementIdsSet),
    [selectedElementIdsSet]
  );

  // UI store — panel visibility + editor modes
  const {
    showFormsPanel,
    isContentEditActive,
    toggleFormsPanel,
    setContentEditActive,
  } = useUIStore(
    useShallow((s) => ({
      showFormsPanel: s.showFormsPanel,
      isContentEditActive: s.isContentEditActive,
      toggleFormsPanel: s.toggleFormsPanel,
      setContentEditActive: s.setContentEditActive,
    }))
  );

  // Canvas handle (via callback) — kept local: transient imperative handle
  const [canvasHandle, setCanvasHandle] = useState<EditorCanvasHandle | null>(null);
  // Ref pour l'input file
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current PDF binary — kept local: File object (resource, not serializable)
  const [currentPdfFile, setCurrentPdfFile] = useState<File | null>(null);

  // Content modifications — kept local: transient editor state (not persisted)
  const [contentModifications, setContentModifications] = useState<ElementModification[]>([]);

  // Ref for the PDF canvas element (for background capture in content edit)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  // Charger le document
  const {
    name,
    pages,
    currentPage,
    currentPageIndex,
    loading,
    error,
    documentId,
    goToPage,
    isDirty,
    setDirty,
    addPage,
    deletePage,
    reorderPages,
    duplicatePage,
    setName,
    outlines,
    layers,
    embeddedFiles,
  } = useDocument({ storedDocumentId });

  // Client-side thumbnails generated via pdfjs (durable solution — no server roundtrip)
  const thumbnails = usePageThumbnails(currentPdfFile, pages.length, { scale: 0.18 });

  // Fetch the actual PDF binary when document loads
  useEffect(() => {
    if (!documentId || !name) return;
    let cancelled = false;

    async function loadPdfBinary() {
      try {
        const downloadUrl = api.getDocumentDownloadUrl(documentId!);
        const { getAuthToken } = await import('@/lib/api');
        const token = await getAuthToken();
        const response = await fetch(downloadUrl, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok || cancelled) return;
        const blob = await response.blob();
        if (cancelled) return;
        const file = new File([blob], `${name}.pdf`, { type: 'application/pdf' });
        setCurrentPdfFile(file);
      } catch (err) {
        clientLogger.error('[editor] Failed to load PDF binary:', err);
      }
    }

    loadPdfBinary();
    return () => { cancelled = true; };
  }, [documentId, name]);

  // État pour l'édition du nom
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sauvegarde hybride (immédiate pour actions critiques, debounced pour modifications mineures)
  const {
    saving,
    saveError,
    lastSaved,
    save,
    saveWithPriority,
    pendingChanges,
  } = useDocumentSave({
    documentId,
    storedDocumentId,
    name,
    isDirty,
    autoSaveInterval: 30000, // Auto-save toutes les 30s comme filet de sécurité
    debounceDelay: 2000, // 2s de debounce pour modifications mineures
    setDirty,
    onSaved: (id) => {
      clientLogger.debug("[editor] Document sauvegardé:", id);
    },
  });

  // Focus input quand on passe en mode édition
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Mettre à jour editedName quand name change
  useEffect(() => {
    setEditedName(name);
  }, [name]);

  // Handlers pour le renommage
  const handleStartRename = useCallback(() => {
    setEditedName(name);
    setIsEditingName(true);
  }, [name]);

  const handleCancelRename = useCallback(() => {
    setEditedName(name);
    setIsEditingName(false);
  }, [name]);

  const handleConfirmRename = useCallback(() => {
    const trimmedName = editedName.trim();
    if (trimmedName && trimmedName !== name) {
      setName(trimmedName);
      setDirty(true);
      saveWithPriority("immediate");
    }
    setIsEditingName(false);
  }, [editedName, name, setName, setDirty, saveWithPriority]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirmRename();
    } else if (e.key === "Escape") {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  // Collaboration temps réel
  const {
    collaborators,
    cursors,
    sendCursorPosition,
    collaboratorCount,
    isConnected,
    emitElementCreate,
    emitElementUpdate,
    emitElementDelete,
  } = useCollaboration({
    documentId,
    enabled: !!documentId,
    onElementCreate: (element) => {
      clientLogger.debug("[editor] Remote element created:", element);
      // TODO: Ajouter l'élément au canvas
    },
    onElementUpdate: (elementId, changes) => {
      clientLogger.debug("[editor] Remote element updated:", elementId, changes);
      // TODO: Mettre à jour l'élément sur le canvas
    },
    onElementDelete: (elementId) => {
      clientLogger.debug("[editor] Remote element deleted:", elementId);
      // TODO: Supprimer l'élément du canvas
    },
  });

  // Ref pour le canvas (pour la position du curseur)
  const canvasRef = useRef<HTMLDivElement>(null);

  // Undo/Redo state via canvas handle
  const canUndo = canvasHandle?.canUndo() ?? false;
  const canRedo = canvasHandle?.canRedo() ?? false;

  // Éléments sélectionnés
  const selectedElements = useMemo(() => {
    if (!currentPage) return [];
    return currentPage.elements.filter((el) =>
      selectedElementIds.includes(el.elementId)
    );
  }, [currentPage, selectedElementIds]);

  // Handlers
  const handleUndo = useCallback(() => {
    canvasHandle?.undo();
  }, [canvasHandle]);

  const handleRedo = useCallback(() => {
    canvasHandle?.redo();
  }, [canvasHandle]);

  const handleDelete = useCallback(() => {
    canvasHandle?.deleteSelected();
    setDirty(true);
    saveWithPriority("immediate");
  }, [canvasHandle, setDirty, saveWithPriority]);

  const handleDuplicate = useCallback(() => {
    canvasHandle?.duplicateSelected();
    setDirty(true);
    saveWithPriority("debounced");
  }, [canvasHandle, setDirty, saveWithPriority]);

  const handleElementAdded = useCallback(
    async (element: Element) => {
      clientLogger.debug("[editor] Element added:", element);
      setDirty(true);
      // Émettre via WebSocket pour la collaboration
      emitElementCreate(element);

      // Persister l'élément dans le backend
      if (documentId) {
        const pageNumber = currentPageIndex + 1;
        try {
          const apiElement = convertToApiElement(element);
          await api.createElement(documentId, pageNumber, apiElement);
          clientLogger.debug("[API] Element created in backend:", element.elementId);
        } catch (error) {
          clientLogger.error("[API] Failed to create element:", error);
        }
      }

      // Sauvegarder le PDF vers S3
      saveWithPriority("immediate");
    },
    [setDirty, emitElementCreate, saveWithPriority, documentId, currentPageIndex]
  );

  const handleElementModified = useCallback(
    async (element: Element) => {
      clientLogger.debug("[editor] Element modified:", element);
      setDirty(true);
      // Émettre via WebSocket pour la collaboration
      emitElementUpdate(element.elementId, element);

      // Mettre à jour l'élément dans le backend
      if (documentId) {
        try {
          const updates = convertToApiElement(element);
          await api.updateElement(documentId, element.elementId, updates);
          clientLogger.debug("[API] Element updated in backend:", element.elementId);
        } catch (error) {
          clientLogger.error("[API] Failed to update element:", error);
        }
      }

      // Sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementUpdate, saveWithPriority, documentId]
  );

  const handleElementRemoved = useCallback(
    async (elementId: string) => {
      clientLogger.debug("[editor] Element removed:", elementId);
      setDirty(true);
      deselectElement(elementId);
      // Émettre via WebSocket pour la collaboration
      emitElementDelete(elementId);

      // Supprimer l'élément du backend
      if (documentId) {
        try {
          await api.deleteElement(documentId, elementId);
          clientLogger.debug("[API] Element deleted from backend:", elementId);
        } catch (error) {
          clientLogger.error("[API] Failed to delete element:", error);
        }
      }

      // Sauvegarder le PDF vers S3
      saveWithPriority("immediate");
    },
    [setDirty, emitElementDelete, saveWithPriority, documentId, deselectElement]
  );

  // Gérer le mouvement du curseur pour la collaboration
  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!canvasRef.current || !currentPage) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (event.clientX - rect.left) / zoom;
      const y = (event.clientY - rect.top) / zoom;
      sendCursorPosition({ x, y }, currentPage.pageId);
    },
    [zoom, currentPage, sendCursorPosition]
  );

  const handleSelectionChanged = useCallback(
    (elementIds: string[]) => {
      if (elementIds.length === 0) {
        clearSelection();
      } else if (currentPage) {
        selectElements(elementIds, currentPage.pageId);
      }
    },
    [currentPage, selectElements, clearSelection]
  );

  const handleElementUpdate = useCallback(
    async (elementId: string, updates: Partial<Element>) => {
      clientLogger.debug("[editor] Element update:", elementId, updates);
      setDirty(true);
      // Émettre via WebSocket pour la collaboration
      emitElementUpdate(elementId, updates as Element);

      // Mettre à jour l'élément dans le backend
      if (documentId) {
        try {
          // Convert only the provided updates to API format
          const apiUpdates: Partial<ElementCreateRequest> = {};
          if (updates.bounds) {
            apiUpdates.bounds = {
              x: updates.bounds.x,
              y: updates.bounds.y,
              width: updates.bounds.width,
              height: updates.bounds.height,
            };
          }
          if (updates.transform) {
            apiUpdates.transform = updates.transform;
          }
          // Check for content property (exists on text, annotation elements)
          if ("content" in updates && updates.content !== undefined) {
            apiUpdates.content = updates.content as string;
          }
          // Check for style property
          if ("style" in updates && updates.style) {
            apiUpdates.style = updates.style as unknown as Record<string, unknown>;
          }
          await api.updateElement(documentId, elementId, apiUpdates);
          clientLogger.debug("[API] Element updated in backend:", elementId);
        } catch (error) {
          clientLogger.error("[API] Failed to update element:", error);
        }
      }

      // Modification via panel propriétés → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementUpdate, saveWithPriority, documentId]
  );

  const handleFormatAction = useCallback(
    (action: string) => {
      clientLogger.debug("[editor] Format action:", action);
      setDirty(true);
      // TODO: Appliquer le formatage aux éléments sélectionnés
      // Modification de style → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [setDirty, saveWithPriority]
  );

  // Flatten PDF handler
  const flattenPdf = useFlattenPdf();
  const pageOperation = usePdfPageOperation();
  const applyElements = useApplyElements();

  const handleExport = useCallback(async () => {
    if (!currentPdfFile) {
      // Fall back to server download if no local PDF
      if (documentId) {
        window.open(api.getDocumentDownloadUrl(documentId), "_blank");
      }
      return;
    }

    try {
      let fileToExport: File | Blob = currentPdfFile;

      // If there are canvas elements on the current page, gather them as add operations
      const canvasElements = currentPage?.elements ?? [];
      const canvasOps = canvasElements.map((el) => ({
        action: 'add' as const,
        pageNumber: currentPageIndex + 1,
        element: el as unknown as Record<string, unknown>,
      }));

      // Combine canvas element ops with content edit modifications
      const allOperations = [...canvasOps, ...contentModifications.map((mod) => ({
        ...mod,
        pageNumber: mod.pageNumber + 1, // content-edit-layer uses 0-indexed, API uses 1-indexed
      }))];

      if (allOperations.length > 0) {
        const modifiedBlob = await applyElements.mutateAsync({
          file: fileToExport,
          operations: allOperations,
        });
        fileToExport = modifiedBlob;
      }

      downloadBlob(fileToExport instanceof Blob ? fileToExport : new Blob([fileToExport]),
        `${name || 'document'}.pdf`);
    } catch (err) {
      clientLogger.error('[editor] Export failed:', err);
      // Fall back to server download
      if (documentId) {
        window.open(api.getDocumentDownloadUrl(documentId), "_blank");
      }
    }
  }, [currentPdfFile, currentPage, currentPageIndex, contentModifications, applyElements, name, documentId]);

  const handleFlattenPdf = async () => {
    if (!currentPdfFile) return;
    try {
      const blob = await flattenPdf.mutateAsync({ file: currentPdfFile });
      downloadBlob(blob, "flattened.pdf");
    } catch (error) {
      clientLogger.error("[editor] Flatten failed:", error);
    }
  };

  const handlePageRotate = useCallback(async (pageIndex: number) => {
    if (!currentPdfFile) return;
    try {
      const result = await pageOperation.mutateAsync({
        file: currentPdfFile,
        action: 'rotate',
        params: { pageNumber: pageIndex + 1, degrees: 90 },
      });
      const file = new File([result as Blob], currentPdfFile.name, { type: 'application/pdf' });
      setCurrentPdfFile(file);
    } catch (err) {
      clientLogger.error('[editor] Rotate failed:', err);
    }
  }, [currentPdfFile, pageOperation]);

  const handlePageExtract = useCallback(async (pageIndex: number) => {
    if (!currentPdfFile) return;
    try {
      const result = await pageOperation.mutateAsync({
        file: currentPdfFile,
        action: 'extract',
        params: { pages: [pageIndex + 1] },
      });
      downloadBlob(result as Blob, `page-${pageIndex + 1}.pdf`);
    } catch (err) {
      clientLogger.error('[editor] Extract failed:', err);
    }
  }, [currentPdfFile, pageOperation]);

  const handleToggleContentEdit = useCallback(() => {
    if (isContentEditActive) {
      // Leaving content edit mode — clear modifications first
      setContentModifications([]);
      setContentEditActive(false);
    } else {
      setContentEditActive(true);
    }
  }, [isContentEditActive, setContentEditActive]);

  const handleContentModificationsChange = useCallback((modifications: ElementModification[]) => {
    setContentModifications(modifications);
  }, []);

  // Handler pour la navigation TOC
  const handleNavigateToPage = useCallback((pageNumber: number) => {
    goToPage(pageNumber - 1); // pageNumber is 1-indexed, goToPage expects 0-indexed
  }, [goToPage]);

  // Handler pour la visibilité des calques
  const handleLayerVisibilityChange = useCallback((layerId: string, visible: boolean) => {
    clientLogger.debug("[editor] Layer visibility changed:", layerId, visible);
    // TODO: Implémenter la logique de changement de visibilité des calques
    setDirty(true);
    saveWithPriority("debounced");
  }, [setDirty, saveWithPriority]);

  // Handler pour le verrouillage des calques
  const handleLayerLockChange = useCallback((layerId: string, locked: boolean) => {
    clientLogger.debug("[editor] Layer lock changed:", layerId, locked);
    // TODO: Implémenter la logique de verrouillage des calques
    setDirty(true);
    saveWithPriority("debounced");
  }, [setDirty, saveWithPriority]);

  // Handler pour le téléchargement de fichiers embarqués
  const handleDownloadFile = useCallback((file: { dataUrl: string; name: string }) => {
    const link = document.createElement("a");
    link.href = file.dataUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // Handler pour les clics sur les liens hypertexte
  const handleHyperlinkClick = useCallback((linkUrl?: string | null, linkPage?: number | null) => {
    if (linkUrl) {
      window.open(linkUrl, "_blank");
    } else if (linkPage) {
      goToPage(linkPage - 1); // linkPage is 1-indexed
    }
  }, [goToPage]);

  // Handler pour l'ajout d'image
  const handleAddImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handler pour le chargement de l'image
  const handleImageFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Vérifier le type de fichier
      if (!file.type.startsWith("image/")) {
        alert(t("error.invalidImageType"));
        return;
      }

      // Vérifier la taille (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert(t("error.imageTooLarge"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          canvasHandle?.addImage(dataUrl, img.width, img.height);
          setDirty(true);
          saveWithPriority("immediate");
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);

      // Reset input pour permettre de sélectionner le même fichier
      event.target.value = "";
    },
    [t, canvasHandle, setDirty, saveWithPriority]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorer si on est dans un input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + Z - Undo
      if (cmdOrCtrl && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y - Redo
      if (
        (cmdOrCtrl && e.shiftKey && e.key === "z") ||
        (cmdOrCtrl && e.key === "y")
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl/Cmd + S - Save
      if (cmdOrCtrl && e.key === "s") {
        e.preventDefault();
        save();
        return;
      }

      // Ctrl/Cmd + D - Duplicate
      if (cmdOrCtrl && e.key === "d") {
        e.preventDefault();
        handleDuplicate();
        return;
      }

      // Delete or Backspace - Delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleDelete();
        }
        return;
      }

      // Escape - Deselect
      if (e.key === "Escape") {
        clearSelection();
        setActiveTool("select");
        return;
      }

      // Tool shortcuts
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            setActiveTool("select");
            break;
          case "t":
            setActiveTool("text");
            break;
          case "s":
            setActiveTool("shape");
            break;
          case "a":
            setActiveTool("annotation");
            break;
          case "h":
            setActiveTool("hand");
            break;
          case "i":
            setActiveTool("image");
            handleAddImage();
            break;
          case "f":
            setActiveTool("form_field");
            break;
        }
      }

      // Zoom shortcuts (canvas-store setZoom clamps to [minZoom, maxZoom])
      if (cmdOrCtrl) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          setZoom(zoom + 0.25);
        } else if (e.key === "-") {
          e.preventDefault();
          setZoom(zoom - 0.25);
        } else if (e.key === "0") {
          e.preventDefault();
          setZoom(1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleUndo,
    handleRedo,
    handleDelete,
    handleDuplicate,
    handleAddImage,
    save,
    selectedElementIds,
    zoom,
    clearSelection,
    setActiveTool,
    setZoom,
  ]);

  // Find the PDF canvas element for content edit background capture
  useEffect(() => {
    if (!isContentEditActive) return;
    // The EditorCanvas renders a canvas element — find it within the main area
    const mainEl = canvasRef.current;
    if (!mainEl) return;
    const canvas = mainEl.querySelector('canvas');
    if (canvas) {
      (pdfCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas;
    }
  }, [isContentEditActive, currentPageIndex]);

  // Rendu conditionnel pour chargement/erreur
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <h2 className="text-lg font-semibold">{t("error.title")}</h2>
            <p className="text-muted-foreground">{error}</p>
          </div>
          <Button onClick={() => router.push("/documents")}>
            {t("error.backToDocuments")}
          </Button>
        </div>
      </div>
    );
  }

  // Informations sur la page actuelle
  const pageInfo = currentPage
    ? {
        width: currentPage.dimensions.width,
        height: currentPage.dimensions.height,
        rotation: currentPage.dimensions.rotation,
      }
    : undefined;

  // Format de la dernière sauvegarde
  const lastSavedText = lastSaved
    ? t("lastSaved", {
        time: lastSaved.toLocaleTimeString(),
      })
    : t("notSaved");

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />

      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/documents">
            <Button variant="ghost" size="icon" title={t("back")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  onBlur={handleConfirmRename}
                  className="text-base font-semibold bg-transparent border-b-2 border-primary outline-none px-1 py-0.5 min-w-[200px]"
                  placeholder={t("untitled")}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleConfirmRename}
                  title={t("confirm")}
                >
                  <Check className="h-3.5 w-3.5 text-green-600" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCancelRename}
                  title={t("cancel")}
                >
                  <X className="h-3.5 w-3.5 text-red-600" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1 group cursor-pointer" onClick={handleStartRename}>
                <h1 className="text-base font-semibold hover:text-primary transition-colors">
                  {name || t("untitled")}
                  {isDirty && <span className="ml-1 text-muted-foreground">*</span>}
                </h1>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("pageIndicator", {
                current: currentPageIndex + 1,
                total: pages.length,
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Collaborateurs connectés */}
          {collaboratorCount > 0 && (
            <CollaboratorsList collaborators={collaborators} maxVisible={4} />
          )}

          {/* Indicateur de connexion WebSocket */}
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={isConnected ? t("connection.connected") : t("connection.disconnected")}
          >
            {isConnected ? (
              <Wifi className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-red-500" />
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              /* TODO: Share modal */
            }}
          >
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">{t("share")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t("export")}</span>
          </Button>
          <Button
            size="sm"
            className="gap-2"
            onClick={save}
            disabled={saving || !isDirty}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{t("save")}</span>
          </Button>
        </div>
      </header>

      {/* Toolbar */}
      <EditorToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={zoom}
        onZoomChange={setZoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        hasSelection={selectedElementIds.length > 0}
        onFormatAction={handleFormatAction}
        shapeType={shapeType}
        onShapeTypeChange={setShapeType}
        annotationType={annotationType}
        onAnnotationTypeChange={setAnnotationType}
        strokeColor={strokeColor}
        onStrokeColorChange={setStrokeColor}
        fillColor={fillColor}
        onFillColorChange={setFillColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onAddImage={handleAddImage}
        currentFile={currentPdfFile}
        onToggleFormsPanel={toggleFormsPanel}
        onFlattenPdf={handleFlattenPdf}
        isContentEditActive={isContentEditActive}
        onToggleContentEdit={handleToggleContentEdit}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Pages sidebar */}
        <PagesSidebar
          pages={pages}
          currentPageIndex={currentPageIndex}
          onPageSelect={goToPage}
          onPageAdd={addPage}
          onPageDelete={deletePage}
          onPageReorder={reorderPages}
          onPageDuplicate={duplicatePage}
          previewBaseUrl={process.env.NEXT_PUBLIC_API_URL}
          onPageRotate={handlePageRotate}
          onPageExtract={handlePageExtract}
          thumbnails={thumbnails}
        />

        {/* Canvas */}
        <main
          ref={canvasRef}
          className="flex-1 overflow-auto relative"
          onMouseMove={handleMouseMove}
        >
          <EditorCanvas
            page={currentPage}
            documentId={documentId}
            tool={activeTool}
            zoom={zoom}
            shapeType={shapeType}
            annotationType={annotationType}
            strokeColor={strokeColor}
            fillColor={fillColor}
            strokeWidth={strokeWidth}
            onElementAdded={handleElementAdded}
            onElementModified={handleElementModified}
            onElementRemoved={handleElementRemoved}
            onSelectionChanged={handleSelectionChanged}
            onZoomChanged={setZoom}
            onCanvasReady={setCanvasHandle}
            onHyperlinkClick={handleHyperlinkClick}
          />

          {/* Content edit layer (deep PDF editing overlay) */}
          <ContentEditLayer
            currentFile={currentPdfFile}
            currentPageIndex={currentPageIndex}
            zoom={zoom}
            isActive={isContentEditActive}
            onModificationsChange={handleContentModificationsChange}
            canvasRef={pdfCanvasRef as React.RefObject<HTMLCanvasElement>}
          />

          {/* Overlay des curseurs des collaborateurs */}
          <CollaborationOverlay
            cursors={cursors}
            currentPageId={currentPage?.pageId}
            zoom={zoom}
          />
        </main>

        {/* Properties panel */}
        <PropertiesPanel
          selectedElements={selectedElements}
          onElementUpdate={handleElementUpdate}
          pageInfo={pageInfo}
          zoom={zoom}
        />

        {/* Document info sidebar (TOC, Layers, Embedded Files) */}
        <DocumentInfoSidebar
          outlines={outlines}
          layers={layers}
          embeddedFiles={embeddedFiles}
          onNavigateToPage={handleNavigateToPage}
          onLayerVisibilityChange={handleLayerVisibilityChange}
          onLayerLockChange={handleLayerLockChange}
          onDownloadFile={handleDownloadFile}
          currentPageIndex={currentPageIndex}
        />

        {/* Forms panel (conditionally shown) */}
        {showFormsPanel && (
          <FormsPanel
            currentFile={currentPdfFile}
            onPdfUpdated={(blob) => {
              // Convert blob back to File for subsequent operations
              const file = new File(
                [blob],
                currentPdfFile?.name ?? "document.pdf",
                { type: "application/pdf" }
              );
              setCurrentPdfFile(file);
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <footer className="flex items-center justify-between border-t px-4 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>
            {t("pageIndicator", {
              current: currentPageIndex + 1,
              total: pages.length,
            })}
          </span>
          <span className="text-muted-foreground/60">
            {t("shortcuts.hint")} (V: Select, T: Text, S: Shape, I: Image, F:
            Form)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {saveError ? (
            <span className="text-destructive">{saveError}</span>
          ) : (
            <>
              {lastSavedText}
              {pendingChanges > 0 && (
                <span className="text-amber-500">
                  ({pendingChanges} {t("pendingChanges")})
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          {t("collaborators", { count: collaboratorCount })}
        </div>
      </footer>
    </div>
  );
}
