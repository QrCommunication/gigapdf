"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Tool, Element } from "@giga-pdf/types";
import { Button } from "@giga-pdf/ui";
import {
  ArrowLeft,
  Save,
  Download,
  Users,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useDocument } from "@/hooks/use-document";
import { useDocumentSave } from "@/hooks/use-document-save";
import { useCollaboration } from "@/hooks/use-collaboration";
import {
  EditorCanvas,
  EditorToolbar,
  PagesSidebar,
  PropertiesPanel,
  CollaborationOverlay,
  CollaboratorsList,
} from "@/components/editor";

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations("editor");

  // ID du document stocké (depuis l'URL)
  const storedDocumentId = params?.id as string;

  // État local
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);

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
  } = useDocument({ storedDocumentId });

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
      console.log("Document sauvegardé:", id);
    },
  });

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
      console.log("Remote element created:", element);
      // TODO: Ajouter l'élément au canvas
    },
    onElementUpdate: (elementId, changes) => {
      console.log("Remote element updated:", elementId, changes);
      // TODO: Mettre à jour l'élément sur le canvas
    },
    onElementDelete: (elementId) => {
      console.log("Remote element deleted:", elementId);
      // TODO: Supprimer l'élément du canvas
    },
  });

  // Ref pour le canvas (pour la position du curseur)
  const canvasRef = useRef<HTMLDivElement>(null);

  // Historique (placeholder pour l'instant)
  const [undoStack] = useState<unknown[]>([]);
  const [redoStack] = useState<unknown[]>([]);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  // Éléments sélectionnés
  const selectedElements = useMemo(() => {
    if (!currentPage) return [];
    return currentPage.elements.filter((el) =>
      selectedElementIds.includes(el.elementId)
    );
  }, [currentPage, selectedElementIds]);

  // Handlers
  const handleUndo = useCallback(() => {
    // TODO: Implémenter undo
    console.log("Undo");
  }, []);

  const handleRedo = useCallback(() => {
    // TODO: Implémenter redo
    console.log("Redo");
  }, []);

  const handleElementAdded = useCallback(
    (element: Element) => {
      console.log("Element added:", element);
      setDirty(true);
      // Émettre via WebSocket pour la collaboration
      emitElementCreate(element);
      // Action critique → sauvegarde immédiate vers S3
      saveWithPriority("immediate");
    },
    [setDirty, emitElementCreate, saveWithPriority]
  );

  const handleElementModified = useCallback(
    (element: Element) => {
      console.log("Element modified:", element);
      setDirty(true);
      // Émettre via WebSocket pour la collaboration
      emitElementUpdate(element.elementId, element);
      // Modification mineure → sauvegarde debounced (2s) vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementUpdate, saveWithPriority]
  );

  const handleElementRemoved = useCallback(
    (elementId: string) => {
      console.log("Element removed:", elementId);
      setDirty(true);
      setSelectedElementIds((prev) => prev.filter((id) => id !== elementId));
      // Émettre via WebSocket pour la collaboration
      emitElementDelete(elementId);
      // Action critique → sauvegarde immédiate vers S3
      saveWithPriority("immediate");
    },
    [setDirty, emitElementDelete, saveWithPriority]
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

  const handleSelectionChanged = useCallback((elementIds: string[]) => {
    setSelectedElementIds(elementIds);
  }, []);

  const handleElementUpdate = useCallback(
    (elementId: string, updates: Partial<Element>) => {
      console.log("Element update:", elementId, updates);
      setDirty(true);
      // Émettre via WebSocket pour la collaboration
      emitElementUpdate(elementId, updates as Element);
      // Modification via panel propriétés → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementUpdate, saveWithPriority]
  );

  const handleFormatAction = useCallback(
    (action: string) => {
      console.log("Format action:", action);
      setDirty(true);
      // TODO: Appliquer le formatage aux éléments sélectionnés
      // Modification de style → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [setDirty, saveWithPriority]
  );

  const handleExport = useCallback(async () => {
    if (!documentId) return;
    // TODO: Implémenter l'export
    window.open(`/api/documents/${documentId}/download`, "_blank");
  }, [documentId]);

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
      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/documents">
            <Button variant="ghost" size="icon" title={t("back")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-base font-semibold">
              {name || t("untitled")}
              {isDirty && <span className="ml-1 text-muted-foreground">*</span>}
            </h1>
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
            title={isConnected ? "Connected" : "Disconnected"}
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
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Pages sidebar */}
        <PagesSidebar
          pages={pages}
          currentPageIndex={currentPageIndex}
          onPageSelect={goToPage}
          previewBaseUrl={process.env.NEXT_PUBLIC_API_URL}
        />

        {/* Canvas */}
        <main
          ref={canvasRef}
          className="flex-1 overflow-hidden relative"
          onMouseMove={handleMouseMove}
        >
          <EditorCanvas
            page={currentPage}
            tool={activeTool}
            zoom={zoom}
            onElementAdded={handleElementAdded}
            onElementModified={handleElementModified}
            onElementRemoved={handleElementRemoved}
            onSelectionChanged={handleSelectionChanged}
            onZoomChanged={setZoom}
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
      </div>

      {/* Status bar */}
      <footer className="flex items-center justify-between border-t px-4 py-1.5 text-xs text-muted-foreground">
        <div>
          {t("pageIndicator", {
            current: currentPageIndex + 1,
            total: pages.length,
          })}
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
