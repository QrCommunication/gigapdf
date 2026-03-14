"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import type { Tool, Element, ShapeType, AnnotationType } from "@giga-pdf/types";

import { useDocument } from "@/hooks/use-document";
import { useDocumentSave } from "@/hooks/use-document-save";
import { api, type ElementCreateRequest } from "@/lib/api";
import {
  EditorCanvas,
  EditorToolbar,
  PagesSidebar,
} from "@/components/editor";
import type { EditorCanvasHandle } from "@/components/editor/editor-canvas";
import {
  useFlattenPdf,
  useApplyElements,
  downloadBlob,
} from "@giga-pdf/api";
import {
  ContentEditLayer,
  type ElementModification,
} from "@/components/editor/content-edit-layer";

// ---------------------------------------------------------------------------
// postMessage types (mirrors packages/embed/src/types.ts)
// ---------------------------------------------------------------------------

interface GigaPdfOutboundMessage {
  type: "gigapdf:command";
  action: "save" | "export" | "load" | "getFile";
  payload?: unknown;
}

interface GigaPdfInboundMessage {
  type: "gigapdf:event";
  event: "ready" | "save" | "export" | "error" | "pageChange" | "complete";
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Allowed tools type (subset from SDK options)
// ---------------------------------------------------------------------------

type AllowedTool =
  | "text"
  | "image"
  | "shape"
  | "annotation"
  | "form"
  | "signature";

// ---------------------------------------------------------------------------
// API key validation (server-side fetch via internal API route)
// ---------------------------------------------------------------------------

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/embed/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
      credentials: "include",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { valid?: boolean };
    return json.valid === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helper: convert frontend Element → API ElementCreateRequest
// ---------------------------------------------------------------------------

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

  if (element.transform) {
    base.transform = {
      rotation: element.transform.rotation,
      scaleX: element.transform.scaleX,
      scaleY: element.transform.scaleY,
      skewX: element.transform.skewX,
      skewY: element.transform.skewY,
    };
  }

  if (element.layerId) {
    base.layer_id = element.layerId;
  }

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
      base.style = element.style as unknown as Record<string, unknown>;
      break;
  }

  return base;
}

// ---------------------------------------------------------------------------
// Helper: check if a Tool is enabled given the `tools` query param
// ---------------------------------------------------------------------------

function isToolAllowed(
  tool: Tool,
  allowedTools: AllowedTool[] | null
): boolean {
  if (!allowedTools) return true; // no restriction

  const mapping: Record<AllowedTool, Tool[]> = {
    text: ["text"],
    image: ["image"],
    shape: ["shape"],
    annotation: ["annotation"],
    form: ["form_field"],
    signature: ["annotation"], // signature is a sub-type of annotation
  };

  return allowedTools.some((allowed) =>
    (mapping[allowed] ?? []).includes(tool)
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EmbedPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  // --- Parse query params from SDK ---
  const apiKey = searchParams?.get("apiKey") ?? "";
  const hideToolbar = searchParams?.get("hideToolbar") === "true";
  const showDoneButton = searchParams?.get("showDoneButton") === "true";
  const toolsParam = searchParams?.get("tools") ?? null;
  const allowedTools: AllowedTool[] | null = toolsParam
    ? (toolsParam.split(",") as AllowedTool[])
    : null;

  // documentId from catch-all segment: /embed/[documentId]
  const catchAll = params?.params as string[] | undefined;
  const documentId = catchAll?.[0] ?? undefined;

  // --- API key validation state ---
  const [keyValidated, setKeyValidated] = useState<
    "pending" | "valid" | "invalid"
  >("pending");

  useEffect(() => {
    if (!apiKey) {
      setKeyValidated("invalid");
      return;
    }

    let cancelled = false;
    validateApiKey(apiKey).then((valid) => {
      if (!cancelled) setKeyValidated(valid ? "valid" : "invalid");
    });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  // --- postMessage helper ---
  const sendToParent = useCallback(
    (message: GigaPdfInboundMessage) => {
      if (typeof window !== "undefined" && window.parent !== window) {
        window.parent.postMessage(message, "*");
      }
    },
    []
  );

  // --- Editor state (only mounted when key is valid) ---
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [shapeType, setShapeType] = useState<ShapeType>("rectangle");
  const [annotationType, setAnnotationType] =
    useState<AnnotationType>("highlight");
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [fillColor, setFillColor] = useState("transparent");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [canvasHandle, setCanvasHandle] =
    useState<EditorCanvasHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentPdfFile, setCurrentPdfFile] = useState<File | null>(null);
  const [isContentEditActive, setIsContentEditActive] = useState(false);
  const [contentModifications, setContentModifications] = useState<
    ElementModification[]
  >([]);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // --- Load document ---
  const {
    name,
    pages,
    currentPage,
    currentPageIndex,
    loading,
    error,
    documentId: sessionDocumentId,
    isDirty,
    setDirty,
    addPage,
    deletePage,
    reorderPages,
    duplicatePage,
    goToPage,
  } = useDocument({ storedDocumentId: documentId });

  // --- Fetch PDF binary when document loads ---
  useEffect(() => {
    if (!sessionDocumentId || !name) return;
    let cancelled = false;

    async function loadPdfBinary() {
      try {
        const downloadUrl = api.getDocumentDownloadUrl(sessionDocumentId!);
        const response = await fetch(downloadUrl, { credentials: "include" });
        if (!response.ok || cancelled) return;
        const blob = await response.blob();
        if (cancelled) return;
        const file = new File([blob], `${name}.pdf`, {
          type: "application/pdf",
        });
        setCurrentPdfFile(file);
      } catch (err) {
        console.error("[Embed] Failed to load PDF binary:", err);
      }
    }

    loadPdfBinary();
    return () => {
      cancelled = true;
    };
  }, [sessionDocumentId, name]);

  // --- Save ---
  const { saving, saveError, lastSaved, save, saveWithPriority, pendingChanges } =
    useDocumentSave({
      documentId: sessionDocumentId,
      storedDocumentId: documentId ?? null,
      name,
      isDirty,
      autoSaveInterval: 30000,
      debounceDelay: 2000,
      setDirty,
      onSaved: (id) => {
        sendToParent({
          type: "gigapdf:event",
          event: "save",
          data: { documentId: id, pageCount: pages.length },
        });
      },
    });

  // --- Notify parent when editor is ready ---
  const readySentRef = useRef(false);
  useEffect(() => {
    if (keyValidated === "valid" && !loading && !error && !readySentRef.current) {
      readySentRef.current = true;
      sendToParent({ type: "gigapdf:event", event: "ready" });
    }
  }, [keyValidated, loading, error, sendToParent]);

  // --- Notify parent on page change ---
  useEffect(() => {
    if (keyValidated !== "valid") return;
    sendToParent({
      type: "gigapdf:event",
      event: "pageChange",
      data: { page: currentPageIndex + 1, total: pages.length },
    });
  }, [currentPageIndex, pages.length, keyValidated, sendToParent]);

  // --- Export handler ---
  const applyElements = useApplyElements();
  const flattenPdf = useFlattenPdf();

  const handleExport = useCallback(async () => {
    try {
      let fileToExport: File | Blob = currentPdfFile!;

      if (!fileToExport) {
        if (sessionDocumentId) {
          window.open(api.getDocumentDownloadUrl(sessionDocumentId), "_blank");
        }
        sendToParent({
          type: "gigapdf:event",
          event: "error",
          data: { code: "EXPORT_NO_FILE", message: "No PDF file loaded" },
        });
        return;
      }

      const canvasElements = currentPage?.elements ?? [];
      const canvasOps = canvasElements.map((el) => ({
        action: "add" as const,
        pageNumber: currentPageIndex + 1,
        element: el as unknown as Record<string, unknown>,
      }));

      const allOperations = [
        ...canvasOps,
        ...contentModifications.map((mod) => ({
          ...mod,
          pageNumber: mod.pageNumber + 1,
        })),
      ];

      if (allOperations.length > 0) {
        const modifiedBlob = await applyElements.mutateAsync({
          file: fileToExport,
          operations: allOperations,
        });
        fileToExport = modifiedBlob;
      }

      const exportBlob =
        fileToExport instanceof Blob
          ? fileToExport
          : new Blob([fileToExport]);

      downloadBlob(exportBlob, `${name || "document"}.pdf`);

      sendToParent({
        type: "gigapdf:event",
        event: "export",
        data: { blob: exportBlob, format: "pdf" },
      });
    } catch (err) {
      console.error("[Embed] Export failed:", err);
      sendToParent({
        type: "gigapdf:event",
        event: "error",
        data: {
          code: "EXPORT_FAILED",
          message: err instanceof Error ? err.message : "Export failed",
        },
      });
      if (sessionDocumentId) {
        window.open(api.getDocumentDownloadUrl(sessionDocumentId), "_blank");
      }
    }
  }, [
    currentPdfFile,
    currentPage,
    currentPageIndex,
    contentModifications,
    applyElements,
    name,
    sessionDocumentId,
    sendToParent,
  ]);

  // --- Get final modified file (for "Done" button or getFile command) ---
  const handleGetFile = useCallback(async () => {
    try {
      let fileToExport: File | Blob = currentPdfFile!;

      if (!fileToExport) {
        sendToParent({
          type: "gigapdf:event",
          event: "error",
          data: { code: "NO_FILE", message: "No PDF file loaded" },
        });
        return;
      }

      const canvasElements = currentPage?.elements ?? [];
      const canvasOps = canvasElements.map((el) => ({
        action: "add" as const,
        pageNumber: currentPageIndex + 1,
        element: el as unknown as Record<string, unknown>,
      }));

      const allOperations = [
        ...canvasOps,
        ...contentModifications.map((mod) => ({
          ...mod,
          pageNumber: mod.pageNumber + 1,
        })),
      ];

      if (allOperations.length > 0) {
        const modifiedBlob = await applyElements.mutateAsync({
          file: fileToExport,
          operations: allOperations,
        });
        fileToExport = modifiedBlob;
      }

      const blob =
        fileToExport instanceof Blob
          ? fileToExport
          : new Blob([fileToExport]);

      sendToParent({
        type: "gigapdf:event",
        event: "complete",
        data: { blob },
      });
    } catch (err) {
      console.error("[Embed] getFile failed:", err);
      sendToParent({
        type: "gigapdf:event",
        event: "error",
        data: {
          code: "GET_FILE_FAILED",
          message: err instanceof Error ? err.message : "Failed to get file",
        },
      });
    }
  }, [
    currentPdfFile,
    currentPage,
    currentPageIndex,
    contentModifications,
    applyElements,
    sendToParent,
  ]);

  // --- Listen for postMessage commands from parent SDK ---
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data as GigaPdfOutboundMessage;
      if (!message || message.type !== "gigapdf:command") return;

      switch (message.action) {
        case "save":
          save().catch(() => {
            sendToParent({
              type: "gigapdf:event",
              event: "error",
              data: { code: "SAVE_FAILED", message: "Save failed" },
            });
          });
          break;

        case "export":
          handleExport();
          break;

        case "load": {
          const payload = message.payload as { documentId?: string } | undefined;
          if (payload?.documentId) {
            // Navigate to embed page for the new document
            window.location.href = `/embed/${payload.documentId}${window.location.search}`;
          }
          break;
        }

        case "getFile":
          handleGetFile();
          break;
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [save, handleExport, handleGetFile, sendToParent]);

  // --- Element handlers ---
  const handleElementAdded = useCallback(
    async (element: Element) => {
      setDirty(true);
      if (sessionDocumentId) {
        const pageNumber = currentPageIndex + 1;
        try {
          const apiElement = convertToApiElement(element);
          await api.createElement(sessionDocumentId, pageNumber, apiElement);
        } catch (err) {
          console.error("[Embed] Failed to create element:", err);
        }
      }
      saveWithPriority("immediate");
    },
    [setDirty, saveWithPriority, sessionDocumentId, currentPageIndex]
  );

  const handleElementModified = useCallback(
    async (element: Element) => {
      setDirty(true);
      if (sessionDocumentId) {
        try {
          const updates = convertToApiElement(element);
          await api.updateElement(sessionDocumentId, element.elementId, updates);
        } catch (err) {
          console.error("[Embed] Failed to update element:", err);
        }
      }
      saveWithPriority("debounced");
    },
    [setDirty, saveWithPriority, sessionDocumentId]
  );

  const handleElementRemoved = useCallback(
    async (elementId: string) => {
      setDirty(true);
      setSelectedElementIds((prev) => prev.filter((id) => id !== elementId));
      if (sessionDocumentId) {
        try {
          await api.deleteElement(sessionDocumentId, elementId);
        } catch (err) {
          console.error("[Embed] Failed to delete element:", err);
        }
      }
      saveWithPriority("immediate");
    },
    [setDirty, saveWithPriority, sessionDocumentId]
  );

  const handleSelectionChanged = useCallback((ids: string[]) => {
    setSelectedElementIds(ids);
  }, []);

  // --- Undo / Redo ---
  const canUndo = canvasHandle?.canUndo() ?? false;
  const canRedo = canvasHandle?.canRedo() ?? false;

  const handleUndo = useCallback(() => canvasHandle?.undo(), [canvasHandle]);
  const handleRedo = useCallback(() => canvasHandle?.redo(), [canvasHandle]);
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

  // --- Image upload ---
  const handleAddImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      if (file.size > 10 * 1024 * 1024) return; // 10 MB guard

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
      event.target.value = "";
    },
    [canvasHandle, setDirty, saveWithPriority]
  );

  // --- Format actions ---
  const handleFormatAction = useCallback(
    (_action: string) => {
      setDirty(true);
      saveWithPriority("debounced");
    },
    [setDirty, saveWithPriority]
  );

  // --- Content edit ---
  const handleToggleContentEdit = useCallback(() => {
    setIsContentEditActive((prev) => {
      if (prev) setContentModifications([]);
      return !prev;
    });
  }, []);

  const handleContentModificationsChange = useCallback(
    (modifications: ElementModification[]) => {
      setContentModifications(modifications);
    },
    []
  );

  // --- Hyperlink click ---
  const handleHyperlinkClick = useCallback(
    (linkUrl?: string | null, linkPage?: number | null) => {
      if (linkUrl) {
        window.open(linkUrl, "_blank");
      } else if (linkPage) {
        goToPage(linkPage - 1);
      }
    },
    [goToPage]
  );

  // --- Tool change respecting the `tools` restriction ---
  const handleToolChange = useCallback(
    (tool: Tool) => {
      if (!isToolAllowed(tool, allowedTools)) return;
      setActiveTool(tool);
      if (tool === "image") handleAddImage();
    },
    [allowedTools, handleAddImage]
  );

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (
        (cmdOrCtrl && e.shiftKey && e.key === "z") ||
        (cmdOrCtrl && e.key === "y")
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (cmdOrCtrl && e.key === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (cmdOrCtrl && e.key === "d") {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedElementIds.length > 0
      ) {
        e.preventDefault();
        handleDelete();
        return;
      }
      if (e.key === "Escape") {
        setSelectedElementIds([]);
        setActiveTool("select");
        return;
      }
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        const toolMap: Record<string, Tool> = {
          v: "select",
          t: "text",
          s: "shape",
          a: "annotation",
          h: "hand",
          i: "image",
          f: "form_field",
        };
        const mapped = toolMap[e.key.toLowerCase()];
        if (mapped) handleToolChange(mapped);
      }
      if (cmdOrCtrl) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          setZoom((z) => Math.min(4, z + 0.25));
        } else if (e.key === "-") {
          e.preventDefault();
          setZoom((z) => Math.max(0.25, z - 0.25));
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
    handleToolChange,
    save,
    selectedElementIds,
  ]);

  // --- Sync content-edit canvas ref ---
  useEffect(() => {
    if (!isContentEditActive) return;
    const mainEl = canvasRef.current;
    if (!mainEl) return;
    const canvas = mainEl.querySelector("canvas");
    if (canvas) {
      (
        pdfCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>
      ).current = canvas;
    }
  }, [isContentEditActive, currentPageIndex]);

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (keyValidated === "pending") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (keyValidated === "invalid") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center px-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium text-destructive">
            Invalid or missing API key
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Provide a valid <code className="font-mono">apiKey</code> when
            initialising the GigaPDF embed SDK.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading document…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center px-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium">Failed to load document</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />

      {/* Toolbar — hidden when hideToolbar=true */}
      {!hideToolbar && (
        <EditorToolbar
          activeTool={activeTool}
          onToolChange={handleToolChange}
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
          onToggleFormsPanel={() => {
            /* forms panel not shown in embed */
          }}
          onFlattenPdf={async () => {
            if (!currentPdfFile) return;
            try {
              const blob = await flattenPdf.mutateAsync({
                file: currentPdfFile,
              });
              downloadBlob(blob, "flattened.pdf");
            } catch (err) {
              console.error("[Embed] Flatten failed:", err);
            }
          }}
          isContentEditActive={isContentEditActive}
          onToggleContentEdit={handleToggleContentEdit}
        />
      )}

      {/* Editor body */}
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
        />

        {/* Canvas area */}
        <main ref={canvasRef} className="flex-1 overflow-auto relative">
          <EditorCanvas
            page={currentPage}
            documentId={sessionDocumentId}
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

          {/* Deep content-edit overlay */}
          <ContentEditLayer
            currentFile={currentPdfFile}
            currentPageIndex={currentPageIndex}
            zoom={zoom}
            isActive={isContentEditActive}
            onModificationsChange={handleContentModificationsChange}
            canvasRef={pdfCanvasRef as React.RefObject<HTMLCanvasElement>}
          />
        </main>
      </div>

      {/* "Done" button for file-in/file-out flow */}
      {showDoneButton && (
        <div className="flex items-center justify-end border-t px-4 py-2 bg-background">
          <button
            onClick={handleGetFile}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Terminé
          </button>
        </div>
      )}

      {/* Minimal status bar — shows save state */}
      <footer className="flex items-center justify-between border-t px-3 py-1 text-xs text-muted-foreground bg-background">
        <span>
          Page {currentPageIndex + 1} / {pages.length}
        </span>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {saveError ? (
            <span className="text-destructive">{saveError}</span>
          ) : lastSaved ? (
            <span>Saved {lastSaved.toLocaleTimeString()}</span>
          ) : null}
          {pendingChanges > 0 && !saving && (
            <span className="text-amber-500">
              {pendingChanges} unsaved change
              {pendingChanges > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
