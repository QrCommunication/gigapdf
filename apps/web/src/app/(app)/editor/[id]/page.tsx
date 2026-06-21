"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import Link from "next/link";
import type {
  Element,
  FormFieldElement,
  TextElement,
  TextStyle,
  UUID,
  PageObject,
} from "@giga-pdf/types";
import { Button, useToast } from "@giga-pdf/ui";
import {
  useCanvasStore,
  useSelectionStore,
  useUIStore,
  useOperationsStore,
  useViewStore,
  buildTableElements,
  buildListContent,
  clonePastedElements,
  extractPaintableStyle,
  applyPaintableStyle,
} from "@giga-pdf/editor";
import type {
  FindOccurrence,
  PaintableTextStyle,
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
  MoreVertical,
  RotateCcw,
  FileText,
  Sheet,
  Presentation,
  FileImage,
  FileCode,
  FileType,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@giga-pdf/ui";

import { useDocument } from "@/hooks/use-document";
import { useDocumentSave } from "@/hooks/use-document-save";
import { useCollaboration } from "@/hooks/use-collaboration";
import { usePageThumbnails } from "@/hooks/use-page-thumbnails";
import { useEmbeddedFonts } from "@giga-pdf/editor";
import { getAuthToken } from "@/lib/api";
import { api, type ElementCreateRequest } from "@/lib/api";
import {
  EditorCanvas,
  EditorToolbar,
  PagesSidebar,
  PropertiesPanel,
  CollaborationOverlay,
  CollaboratorsList,
  DocumentInfoSidebar,
  ContinuousPageView,
} from "@/components/editor";
import type { ContinuousPageViewHandle } from "@/components/editor";
import type { InsertLinkValue } from "@/components/editor/insert-link-dialog";
import { EditorEditTools } from "@/components/editor/editor-edit-tools";
import { FindReplaceDialog } from "@/components/editor/find-replace-dialog";
import type {
  EditorCanvasHandle,
  TextFormatAction,
} from "@/components/editor/editor-canvas";
import {
  FormsPanel,
  type FormsPanelMode,
  type LoadedFormField,
} from "@/components/editor/forms-panel";
import { FormFillOverlay } from "@/components/editor/form-fill-overlay";
import { ShareDialog } from "@/components/sharing/share-dialog";
import {
  useFlattenPdf,
  usePdfPageOperation,
  downloadBlob,
  useApplyElements,
  useElementUpdates,
  useDocumentLayers,
  useSaveDocumentLayers,
  socketClient,
  type SocketEventData,
} from "@giga-pdf/api";
import { ContentEditLayer, type ElementModification } from "@/components/editor/content-edit-layer";
import {
  applyPageMargins,
  type PageMargins,
} from "@/components/editor/lib/page-margins";
import {
  applyHeaderFooter,
  removeHeaderFooter,
  detectHeaderFooter,
  type HeaderFooterKind,
} from "@/components/editor/lib/page-headers-footers";
import {
  exportDocumentAs,
  exportFilename,
} from "@/components/editor/lib/export-document";
import { exportPagesAsImages } from "@/components/editor/lib/export-pages-as-images";
import { extractDocumentText } from "@/components/editor/lib/extract-text";
import {
  redactDocument,
  groupRectsByPage,
  type PageGeometry,
  type WebRedactionRect,
} from "@/components/editor/lib/redact-pii";
import type { ExportFormat } from "@/components/editor/lib/export-formats";
import type { HeaderFooterSpec } from "@qrcommunication/gigapdf-lib";
import { clientLogger } from "@/lib/client-logger";
import { withRetry } from "@/lib/with-retry";
import {
  buildMembership,
  mergeSavedLayers,
} from "@/lib/layer-persistence";

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

/** Identifiers emitted by the toolbar formatting buttons (kebab-case). */
type ToolbarFormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "align-left"
  | "align-center"
  | "align-right";

/**
 * Map toolbar identifiers to the canvas TextFormatAction contract
 * (camelCase) exposed by EditorCanvasHandle.applyTextFormat.
 */
const TOOLBAR_FORMAT_TO_TEXT_FORMAT: Record<
  ToolbarFormatAction,
  TextFormatAction
> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  "align-left": "alignLeft",
  "align-center": "alignCenter",
  "align-right": "alignRight",
};

// Universal export menu (#84): the editable formats the GigaPDF SDK lowers the
// current document into, with their menu icon + i18n key (under `editor.office`).
const SDK_EXPORT_ITEMS: ReadonlyArray<{
  format: ExportFormat;
  icon: LucideIcon;
  labelKey: string;
}> = [
  { format: "docx", icon: FileText, labelKey: "office.exportWordEditable" },
  { format: "odt", icon: FileText, labelKey: "office.exportOdt" },
  { format: "xlsx", icon: Sheet, labelKey: "office.exportExcelEditable" },
  { format: "ods", icon: Sheet, labelKey: "office.exportOds" },
  { format: "pptx", icon: Presentation, labelKey: "office.exportPowerPointEditable" },
  { format: "odp", icon: Presentation, labelKey: "office.exportOdp" },
  { format: "html", icon: FileCode, labelKey: "office.exportHtmlEditable" },
  { format: "rtf", icon: FileType, labelKey: "office.exportRtf" },
  { format: "pdf", icon: Download, labelKey: "office.exportPdf" },
];

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("editor");
  const { toast } = useToast();

  // ID du document stocké (depuis l'URL)
  const storedDocumentId = params?.id as string;

  // Deep-link target page (?page=N, 1-based) — e.g. opened from a semantic
  // search hit. Applied once, after the pages load (see effect below).
  const deepLinkAppliedRef = useRef(false);

  // Share dialog (GED) — partage le document STOCKÉ (storedDocumentId)
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Canvas store — tool, zoom, tool options
  const {
    activeTool,
    zoom,
    fitMode,
    shapeType,
    annotationType,
    fieldKind,
    strokeColor,
    fillColor,
    strokeWidth,
    viewMode,
    showRulers,
    rulerUnit,
    setActiveTool,
    setZoom,
    setFitMode,
    setShapeType,
    setAnnotationType,
    setFieldKind,
    setStrokeColor,
    setFillColor,
    setStrokeWidth,
    setViewMode,
    toggleRulers,
    setRulerUnit,
    setCurrentPage: setCanvasCurrentPage,
  } = useCanvasStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      zoom: s.zoom,
      fitMode: s.fitMode,
      shapeType: s.shapeType,
      annotationType: s.annotationType,
      fieldKind: s.fieldKind,
      strokeColor: s.strokeColor,
      fillColor: s.fillColor,
      strokeWidth: s.strokeWidth,
      viewMode: s.viewMode,
      showRulers: s.showRulers,
      rulerUnit: s.rulerUnit,
      setActiveTool: s.setActiveTool,
      setZoom: s.setZoom,
      setFitMode: s.setFitMode,
      setShapeType: s.setShapeType,
      setAnnotationType: s.setAnnotationType,
      setFieldKind: s.setFieldKind,
      setStrokeColor: s.setStrokeColor,
      setFillColor: s.setFillColor,
      setStrokeWidth: s.setStrokeWidth,
      setViewMode: s.setViewMode,
      toggleRulers: s.toggleRulers,
      setRulerUnit: s.setRulerUnit,
      setCurrentPage: s.setCurrentPage,
    }))
  );

  // Zoom MANUEL (molette, presets, ±, Ctrl+1) : sort du mode fit — le fit ne
  // doit plus recalculer par-dessus le choix explicite de l'utilisateur.
  // Les modes fit, eux, passent par setZoom directement (onFitZoomChange).
  const handleManualZoomChange = useCallback(
    (newZoom: number) => {
      setFitMode(null);
      setZoom(newZoom);
    },
    [setFitMode, setZoom],
  );

  const handleFitPage = useCallback(() => setFitMode("page"), [setFitMode]);
  const handleFitWidth = useCallback(() => setFitMode("width"), [setFitMode]);

  // View store — active page in the continuous (Word-like) scroller. The
  // continuous view writes activePageIndex on click; the page-scoped panels
  // read it (see effectivePageIndex below). Single-page mode ignores it.
  const { activePageIndex, setActivePageIndex } = useViewStore(
    useShallow((s) => ({
      activePageIndex: s.activePageIndex,
      setActivePageIndex: s.setActivePageIndex,
    }))
  );

  // Imperative handle to the continuous scroller (scrollToPage on jumps).
  const continuousViewRef = useRef<ContinuousPageViewHandle>(null);

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
    headersFootersEnabled,
    toggleHeadersFooters,
    setHeadersFootersEnabled,
  } = useUIStore(
    useShallow((s) => ({
      showFormsPanel: s.showFormsPanel,
      isContentEditActive: s.isContentEditActive,
      toggleFormsPanel: s.toggleFormsPanel,
      setContentEditActive: s.setContentEditActive,
      headersFootersEnabled: s.headersFootersEnabled,
      toggleHeadersFooters: s.toggleHeadersFooters,
      setHeadersFootersEnabled: s.setHeadersFootersEnabled,
    }))
  );

  // Canvas handle (via callback) — kept local: transient imperative handle
  const [canvasHandle, setCanvasHandle] = useState<EditorCanvasHandle | null>(null);

  // --- Formulaires : mode Concevoir / Remplir -----------------------------
  // Concevoir = placer/éditer des champs (comportement historique).
  // Remplir = les champs EXISTANTS du PDF sont listés (FormsPanel) ET
  // surlignés sur le canvas (FormFillOverlay) ; saisie + application via
  // /api/pdf/forms. États locaux : purement UI, non persistés.
  const [formsMode, setFormsMode] = useState<FormsPanelMode>("design");
  const [loadedFormFields, setLoadedFormFields] = useState<LoadedFormField[]>([]);
  const [focusedFormField, setFocusedFormField] = useState<string | null>(null);
  // Ref pour l'input file
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current PDF binary — kept local: File object (resource, not serializable)
  const [currentPdfFile, setCurrentPdfFile] = useState<File | null>(null);

  // True while a Word-style header/footer band is being baked onto the PDF —
  // drives the dialog's busy state so the user can't fire overlapping bakes.
  const [headerFooterBusy, setHeaderFooterBusy] = useState(false);
  // PII redaction tool: live count of zones drawn on the active page (reported
  // by the canvas) + busy flag while the engine bakes the redaction.
  const [redactionMarkCount, setRedactionMarkCount] = useState(0);
  const [redactBusy, setRedactBusy] = useState(false);
  // Text of the header/footer the document already carried when it was opened
  // (recovered via the SDK's headerFooter() reader). Seeds the dialog so the
  // Word-like editor reflects existing document state (#76, P4).
  const [headerFooterInitialHeader, setHeaderFooterInitialHeader] = useState<
    string | undefined
  >(undefined);
  const [headerFooterInitialFooter, setHeaderFooterInitialFooter] = useState<
    string | undefined
  >(undefined);
  // Guards the one-shot header/footer auto-detect so it runs once per opened
  // document and never re-fires on subsequent binary mutations (which would
  // re-enable the toggle the user just turned off).
  const headerFooterDetectedRef = useRef(false);
  // True while the current page is being OCR'd + ingested into the semantic
  // index (#85) — disables the toolbar button to prevent overlapping runs.
  const [indexOcrBusy, setIndexOcrBusy] = useState(false);

  // Content modifications — backed by localStorage so a reload during the
  // 2s save debounce window doesn't drop user edits. The cache is scoped to
  // storedDocumentId and cleared by the onSaved callback once S3 confirms the
  // upload (see useDocumentSave below).
  const contentModsStorageKey = storedDocumentId
    ? `gigapdf:contentMods:${storedDocumentId}`
    : null;
  const [contentModifications, setContentModificationsState] = useState<ElementModification[]>(() => {
    if (typeof window === "undefined" || !contentModsStorageKey) return [];
    try {
      const raw = window.localStorage.getItem(contentModsStorageKey);
      return raw ? (JSON.parse(raw) as ElementModification[]) : [];
    } catch {
      return [];
    }
  });
  const setContentModifications = useCallback(
    (next: ElementModification[] | ((prev: ElementModification[]) => ElementModification[])) => {
      setContentModificationsState((prev) => {
        const value = typeof next === "function" ? (next as (p: ElementModification[]) => ElementModification[])(prev) : next;
        if (typeof window !== "undefined" && contentModsStorageKey) {
          try {
            if (value.length === 0) {
              window.localStorage.removeItem(contentModsStorageKey);
            } else {
              window.localStorage.setItem(contentModsStorageKey, JSON.stringify(value));
            }
          } catch {
            // Quota exceeded or storage disabled — modifications stay in memory.
          }
        }
        return value;
      });
    },
    [contentModsStorageKey],
  );

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
    addPage: addPageLocal,
    deletePage: deletePageLocal,
    reorderPages: reorderPagesLocal,
    duplicatePage: duplicatePageLocal,
    addElementToPage,
    updateElementInPage,
    removeElementFromPage,
    replacePages,
    setName,
    outlines,
    layers,
    userLayers,
    createLayer,
    deleteLayer,
    renameLayer,
    reorderLayer,
    setLayerVisible,
    setLayerLocked,
    assignElementToLayer,
    restoreLayers,
    embeddedFiles,
    flattenedPdfFile,
  } = useDocument({ storedDocumentId, flatten: true });

  // Client-side thumbnails generated via pdfjs (durable solution — no server roundtrip)
  const thumbnails = usePageThumbnails(currentPdfFile, pages.length, { scale: 0.18 });

  // ── Continuous vs single view ─────────────────────────────────────────────
  // In continuous mode the page-scoped panels (Properties / Content edit /
  // Forms / Layers) follow the ACTIVE page (the one the user clicked into),
  // tracked in the view store. In single mode they follow useDocument's
  // current page. `effectivePageIndex`/`effectivePage` unify the two so the
  // panels stay agnostic of the layout mode.
  const isContinuous = viewMode === "continuous";
  const effectivePageIndex = useMemo(() => {
    const raw = isContinuous ? activePageIndex : currentPageIndex;
    if (pages.length === 0) return 0;
    return Math.min(Math.max(0, raw), pages.length - 1);
  }, [isContinuous, activePageIndex, currentPageIndex, pages.length]);
  const effectivePage = useMemo<PageObject | null>(
    () => pages[effectivePageIndex] ?? null,
    [pages, effectivePageIndex]
  );

  // Activate a page in the continuous scroller: it becomes the focused page
  // (editable overlay) and drives the page-scoped panels + selection store.
  // Cheap and idempotent — safe to call on every click.
  const activatePage = useCallback(
    (index: number) => {
      setActivePageIndex(index);
      setCanvasCurrentPage(index);
      const page = pages[index];
      if (page) {
        // Keep the selection store's page in sync so panel selection logic and
        // the next element-create target resolve to the right page.
        selectElements([], page.pageId);
      }
    },
    [setActivePageIndex, setCanvasCurrentPage, pages, selectElements]
  );

  // ── Cross-session layer persistence (P2b) ─────────────────────────────────
  // User layers + element→layer membership are keyed by the STORED document id
  // (not any transient session id) and survive a reload. On open we fetch the
  // saved snapshot, then merge it into the freshly-parsed scene graph: restore
  // the layers and re-attach membership for elements whose deterministic id
  // still exists (P1). Subsequent layer mutations are PUT back debounced.
  const { data: savedLayersData } = useDocumentLayers(storedDocumentId);
  const saveDocumentLayers = useSaveDocumentLayers();
  // Guards the one-shot load-merge: blocks the debounced save from firing while
  // restoring, and prevents the merge from running twice for the same load.
  const layersMergedRef = useRef(false);
  const layersSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-arm the merge guard whenever a new document finishes (re)loading.
  useEffect(() => {
    layersMergedRef.current = false;
  }, [storedDocumentId]);

  // Load + merge: runs once, after the parse completes AND the saved snapshot
  // has arrived. `savedLayersData` is undefined while the query is in flight.
  useEffect(() => {
    if (layersMergedRef.current) return;
    if (loading) return; // wait for parse
    if (pages.length === 0) return;
    if (savedLayersData === undefined) return; // wait for the GET
    const { layers: restoredLayers, membership } = mergeSavedLayers(
      savedLayersData,
      pages,
    );
    layersMergedRef.current = true;
    if (restoredLayers.length === 0) return; // nothing saved → no-op
    restoreLayers(restoredLayers, membership);
  }, [loading, pages, savedLayersData, restoreLayers]);

  // Debounced save (~800ms trailing) on any layer mutation. Skipped until the
  // initial load-merge has run (avoids overwriting the saved snapshot with the
  // pre-restore empty state). `userLayers` identity changes on every mutation,
  // and `pages` identity changes on membership/visibility/lock cascades, so
  // both drive the snapshot rebuild.
  useEffect(() => {
    if (!storedDocumentId) return;
    if (!layersMergedRef.current) return; // not yet restored → don't clobber
    if (layersSaveTimerRef.current) clearTimeout(layersSaveTimerRef.current);
    layersSaveTimerRef.current = setTimeout(() => {
      saveDocumentLayers.mutate({
        storedDocumentId,
        data: { layers: userLayers, membership: buildMembership(pages) },
      });
    }, 800);
    return () => {
      if (layersSaveTimerRef.current) clearTimeout(layersSaveTimerRef.current);
    };
    // saveDocumentLayers identity is stable across renders (TanStack mutation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedDocumentId, userLayers, pages]);

  // Unified page navigation (sidebar / TOC / header / search / keyboard).
  // Always advances useDocument's pointer; in continuous mode it ALSO focuses
  // the page and smooth-scrolls it into view.
  const navigateToPage = useCallback(
    (index: number, align: "start" | "center" = "start") => {
      const clamped =
        pages.length === 0
          ? 0
          : Math.min(Math.max(0, index), pages.length - 1);
      goToPage(clamped);
      if (isContinuous) {
        activatePage(clamped);
        continuousViewRef.current?.scrollToPage(clamped, align);
      }
    },
    [pages.length, goToPage, isContinuous, activatePage]
  );

  // Apply the ?page=N deep link once the document's pages are available (opened
  // from a semantic-search result). Runs a single time per mount.
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (pages.length === 0) return;
    const pageParam = searchParams?.get("page");
    if (!pageParam) {
      deepLinkAppliedRef.current = true;
      return;
    }
    const target = Number(pageParam);
    if (Number.isInteger(target) && target >= 1) {
      navigateToPage(target - 1, "start");
    }
    deepLinkAppliedRef.current = true;
  }, [pages.length, searchParams, navigateToPage]);

  // Dynamically load embedded PDF fonts via FontFace API (backed by IndexedDB cache).
  // Maps originalFont names (like "g_d0_f1") to real CSS font-family names,
  // so Fabric can render text with the SAME font as the PDF background.
  const { getFontFaceName } = useEmbeddedFonts({
    documentId: documentId || "",
    enabled: Boolean(documentId),
    getAuthToken,
  });

  // Fetch the actual PDF binary when document loads. Skipped when a flattened
  // file is present (the flatten-adopt effect below adopts those canonical
  // bytes instead), so we never overwrite the flattened content with the
  // un-flattened original. `updateCurrentPdfFile` is intentionally not in the
  // deps — it's a stable useCallback declared further down (referencing it in
  // the dep array here would hit its TDZ at render time).
  useEffect(() => {
    if (!documentId || !name) return;
    if (flattenedPdfFile) return;
    let cancelled = false;
    // Re-arm the one-shot header/footer auto-detect for this (re)load.
    headerFooterDetectedRef.current = false;

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
        updateCurrentPdfFile(file);

        // One-shot auto-detect of a header/footer already baked into the
        // opened document (#76, P4). Read the freshly-fetched bytes with the
        // SDK reader; if a band is present, enable the Word-style toggle and
        // pre-fill the dialog. Guarded by a ref so it runs once per document
        // and never re-fires after later binary mutations.
        if (!headerFooterDetectedRef.current) {
          headerFooterDetectedRef.current = true;
          try {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            if (cancelled) return;
            const { header, footer } = await detectHeaderFooter(bytes);
            if (cancelled) return;
            if (header) setHeaderFooterInitialHeader(header);
            if (footer) setHeaderFooterInitialFooter(footer);
            if (header || footer) setHeadersFootersEnabled(true);
          } catch (err) {
            clientLogger.warn('[editor] header/footer auto-detect failed:', err);
          }
        }
      } catch (err) {
        clientLogger.error('[editor] Failed to load PDF binary:', err);
      }
    }

    loadPdfBinary();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, name, flattenedPdfFile]);

  // État pour l'édition du nom
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // PDF mutations — hoisted above useDocumentSave so getPreparedBlob can use them
  const flattenPdf = useFlattenPdf();
  const pageOperation = usePdfPageOperation();
  const applyElements = useApplyElements();

  // currentPdfFile is the single source of truth for the PDF binary. It
  // receives every local mutation (rotate/extract/element add/modify/delete
  // via apply-elements). The save flow uploads this blob directly, so any
  // op that already updated currentPdfFile is persisted, even if the op
  // queue is empty at save time.
  //
  // We keep a ref alongside the state because setState is async: callers
  // that invoke save() immediately after setCurrentPdfFile would otherwise
  // read the stale closure value and upload the pre-mutation binary. The
  // ref is updated synchronously before every save trigger.
  const peekOperations = useOperationsStore((s) => s.peek);
  const drainOperations = useOperationsStore((s) => s.drain);
  const currentPdfFileRef = useRef<File | null>(null);
  const contentModificationsRef = useRef<ElementModification[]>([]);
  // ElementIds that were baked into the PDF in the most recent apply-elements
  // call. They should be removed from the Redis backend ONLY after the S3
  // upload succeeds — flushed by the onSaved callback below. Keeping them
  // in Redis until S3 confirms means a transient upload failure is recoverable
  // (Redis still has the user data, scene graph rebuilds via merge on reload).
  const pendingFlushIdsRef = useRef<string[]>([]);

  const updateCurrentPdfFile = useCallback((file: File | null) => {
    currentPdfFileRef.current = file;
    setCurrentPdfFile(file);
  }, []);

  // Adopt the flattened PDF (Form XObjects inlined by parse-from-s3) as the
  // binary source of truth. Runs once when the flattened file arrives from the
  // load. The parsed `elements` already correspond to these bytes, so this
  // keeps currentPdfFile consistent with the scene graph (save + raster +
  // apply-operations all run on the flattened content → in-place text edits).
  // No-op for form-less docs (flattenedPdfFile stays null → raw download wins).
  useEffect(() => {
    if (!flattenedPdfFile) return;
    updateCurrentPdfFile(flattenedPdfFile);
  }, [flattenedPdfFile, updateCurrentPdfFile]);

  const getPreparedBlob = useCallback(async (): Promise<Blob | null> => {
    const pdfFile = currentPdfFileRef.current;
    if (!pdfFile) {
      // pdfFile is null only before the initial load resolves. The save flow
      // falls back to fetching S3, which is safe in this state because the
      // canonical binary IS S3 until the local copy is hydrated.
      const pendingOps = peekOperations();
      if (pendingOps.length > 0) {
        clientLogger.warn(
          "[editor] getPreparedBlob: queue has",
          pendingOps.length,
          "ops but pdfFile is not loaded yet — save will retry once the binary is available",
        );
      }
      return null;
    }

    // Peek (don't drain yet): if apply-elements throws between the drain and
    // the catch block, ops would be silently lost — even prependOperations
    // could race with concurrent save attempts. Drain only AFTER we know the
    // binary was successfully patched.
    const ops = peekOperations();
    const contentMods = contentModificationsRef.current;

    // Nothing to bake — upload the current in-memory PDF as-is. This covers
    // page-level ops (rotate/extract) that already mutated currentPdfFile.
    if (ops.length === 0 && contentMods.length === 0) {
      return pdfFile;
    }

    // Merge element ops + content-edit-layer mods into a single apply call.
    const allOps = [
      ...ops.map((op) => ({
        action: op.action,
        pageNumber: op.pageNumber,
        element: op.element as Record<string, unknown>,
        ...(op.oldBounds ? { oldBounds: op.oldBounds } : {}),
      })),
      ...contentMods.map((mod) => ({
        ...mod,
        pageNumber: mod.pageNumber + 1, // content-edit-layer is 0-indexed
      })),
    ];

    try {
      const modified = await applyElements.mutateAsync({
        file: pdfFile,
        operations: allOps,
      });
      // apply-elements succeeded — now it's safe to drain the queue. Anything
      // queued AFTER our peek stays for the next save tick.
      drainOperations();

      const blob =
        modified instanceof Blob ? modified : new Blob([modified as BlobPart]);
      // Update local cache so subsequent ops apply on top of the new binary.
      updateCurrentPdfFile(
        new File([blob], pdfFile.name, { type: "application/pdf" }),
      );
      // Clear content modifications now that they're baked in.
      setContentModifications([]);

      // Stash the elementIds for post-upload Redis flush. We can't delete
      // from Redis here because S3 hasn't confirmed yet — if upload fails,
      // Redis is still our recovery source on next reload (via merge).
      const elementIdsBaked = ops
        .map((op) => {
          const el = op.element as { elementId?: string };
          return el?.elementId;
        })
        .filter((id): id is string => Boolean(id));
      if (elementIdsBaked.length > 0) {
        pendingFlushIdsRef.current.push(...elementIdsBaked);
      }

      return blob;
    } catch (err) {
      clientLogger.error("[editor] apply-elements failed during save:", err);
      // Don't drain the queue — ops stay in the store for the next save tick.
      // Returning the last known good binary means the upload still goes
      // through, and the user's pending ops are preserved for retry.
      return pdfFile;
    }
  }, [peekOperations, drainOperations, applyElements, updateCurrentPdfFile]);

  // Keep the ref in sync so getPreparedBlob can read the latest mods without
  // being reconstructed on every keystroke.
  useEffect(() => {
    contentModificationsRef.current = contentModifications;
  }, [contentModifications]);

  // PARTIE 4 — Rafraîchissement des métadonnées GED après un save éditeur.
  // Best-effort + throttlé (max 1 fois / 60s) : (a) régénère la miniature du
  // document stocké depuis le binaire sauvegardé, (b) reconstruit le texte de
  // recherche full-text depuis les éléments text du scene graph EN MÉMOIRE
  // (aucun re-parse). Les échecs sont silencieux (warn console uniquement) —
  // la GED se rattrapera au prochain save au-delà de la fenêtre de throttle.
  //
  // pagesRef : le onSaved du save debounced/auto peut s'exécuter longtemps
  // après la construction de sa closure — on lit l'état pages via ref pour
  // éviter un texte de recherche figé sur un scene graph périmé.
  const lastGedRefreshRef = useRef(0);
  const pagesRef = useRef<PageObject[]>(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const refreshGedMetadata = useCallback(async () => {
    if (!storedDocumentId) return;
    const now = Date.now();
    if (now - lastGedRefreshRef.current < 60_000) return;
    lastGedRefreshRef.current = now;

    // (a) Miniature : rend la page 1 du binaire sauvegardé en PNG via
    // /api/pdf/preview (mode thumbnail) puis l'upload vers la GED.
    const pdfFile = currentPdfFileRef.current;
    if (pdfFile) {
      try {
        const token = await getAuthToken();
        const form = new FormData();
        form.append("file", pdfFile, pdfFile.name);
        form.append("mode", "thumbnail");
        form.append("pageNumber", "1");
        form.append("format", "png");
        form.append("maxWidth", "480");
        form.append("maxHeight", "640");
        const res = await fetch("/api/pdf/preview", {
          method: "POST",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (res.ok) {
          const png = await res.blob();
          await api.uploadDocumentThumbnail(storedDocumentId, png);
          clientLogger.debug("[editor] GED thumbnail refreshed");
        } else {
          clientLogger.warn(
            "[editor] GED thumbnail refresh failed:",
            res.status,
          );
        }
      } catch (err) {
        clientLogger.warn("[editor] GED thumbnail refresh failed:", err);
      }
    }

    // (b) Texte de recherche : concatène le contenu de TOUS les éléments
    // text du scene graph en mémoire, tronqué à 500k caractères.
    try {
      const parts: string[] = [];
      for (const page of pagesRef.current) {
        for (const el of page.elements) {
          if (el.type === "text" && el.content) parts.push(el.content);
        }
      }
      const extractedText = parts.join("\n").slice(0, 500_000);
      if (extractedText.length > 0) {
        await api.updateStoredDocument(storedDocumentId, {
          extracted_text: extractedText,
        });
        clientLogger.debug(
          "[editor] GED search text refreshed:",
          extractedText.length,
          "chars",
        );
      }
    } catch (err) {
      clientLogger.warn("[editor] GED search-text refresh failed:", err);
    }
  }, [storedDocumentId]);

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
    getPreparedBlob,
    onSaved: async (id) => {
      clientLogger.debug("[editor] Document sauvegardé:", id);
      // PARTIE 4 — best-effort GED refresh (miniature + texte de recherche),
      // fire-and-forget : ne bloque ni le flush Redis ni le flux de save.
      void refreshGedMetadata();
      // Flush Redis backend for elements that were baked into the PDF in the
      // last apply-elements pass. We only run this AFTER S3 confirms the
      // upload, otherwise a transient upload failure would lose the data
      // permanently (Redis cleared + S3 unchanged).
      const flushIds = pendingFlushIdsRef.current;
      if (flushIds.length === 0 || !documentId) return;
      pendingFlushIdsRef.current = [];
      try {
        await api.batchElementOperations(
          documentId,
          flushIds.map((elementId) => ({
            action: "delete" as const,
            element_id: elementId,
          })),
        );
        clientLogger.debug(
          "[editor] Redis flushed for",
          flushIds.length,
          "baked elements",
        );
      } catch (err) {
        // Non-fatal: harmless duplicate at next reload (caught by the dedup
        // heuristic in mergeBackendElements). Push the ids back so a later
        // save tick gets another chance to clean up.
        pendingFlushIdsRef.current.push(...flushIds);
        clientLogger.warn(
          "[editor] Redis flush failed — will retry next save:",
          err,
        );
      }
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

  // Collaboration temps réel (présence, curseurs, émissions update/delete)
  const {
    collaborators,
    cursors,
    sendCursorPosition,
    collaboratorCount,
    isConnected,
    emitElementUpdate,
    emitElementDelete,
  } = useCollaboration({
    documentId,
    enabled: !!documentId,
  });

  // --- Application des événements de collaboration distants ---
  // Abonnement direct via useElementUpdates (et non via les callbacks de
  // useCollaboration) : ce dernier strippe l'enveloppe socket et ne transmet
  // que l'élément — or le routage nécessite page_number et l'anti-écho
  // nécessite client_id, présents uniquement dans le payload brut.
  //
  // Aucune de ces trois branches ne déclenche queueAdd/queueUpdate/queueDelete
  // ni saveWithPriority : l'émetteur a déjà persisté (Redis + bake S3) — les
  // re-saver ici provoquerait un double-bake du même élément.
  const handleRemoteElementCreate = useCallback(
    (data: SocketEventData["element:create"]) => {
      // Anti-écho (ceinture) : socketClient filtre déjà au dispatch les
      // événements portant notre propre client_id ; on re-vérifie au cas où
      // un futur relay serveur contournerait le wrapper du provider.
      if (data.client_id && data.client_id === socketClient.getClientId()) {
        return;
      }
      const element = data.element as Element | null;
      if (!element?.elementId) return;

      // Routage : page_number (1-indexé) fourni par l'émetteur ; fallback
      // page courante pour les émetteurs qui ne l'envoient pas encore.
      const pageIndex =
        typeof data.page_number === "number" && data.page_number >= 1
          ? data.page_number - 1
          : currentPageIndex;

      clientLogger.debug(
        "[editor] Remote element created:",
        element.elementId,
        "page:",
        pageIndex + 1,
      );

      // Idempotence : double délivrance réseau ou élément déjà connu →
      // traiter comme une mise à jour plutôt que d'empiler un doublon.
      const ownerPageIndex = pages.findIndex((p) =>
        p.elements.some((e) => e.elementId === element.elementId),
      );
      if (ownerPageIndex !== -1) {
        updateElementInPage(element.elementId, element);
        if (ownerPageIndex === currentPageIndex) {
          canvasHandle?.applyRemoteElementUpdate(element);
        }
        return;
      }

      // 1. Scene graph React (toutes pages — une page non affichée sera
      //    rendue à la navigation via loadPage).
      addElementToPage(pageIndex, element);
      // 2. Canvas Fabric uniquement si la page est actuellement affichée.
      if (pageIndex === currentPageIndex) {
        canvasHandle?.applyRemoteElementCreate(element);
      }
    },
    [pages, currentPageIndex, addElementToPage, updateElementInPage, canvasHandle],
  );

  const handleRemoteElementUpdate = useCallback(
    (data: SocketEventData["element:update"]) => {
      if (data.client_id && data.client_id === socketClient.getClientId()) {
        return;
      }
      const elementId = data.element_id;
      if (!elementId) return;
      const changes = data.changes as Partial<Element> | null;
      if (!changes) return;

      // Reconstruire l'Element complet : le payload peut être partiel
      // (modification via panel propriétés) — merge sur l'élément connu.
      const ownerPage = pages.find((p) =>
        p.elements.some((e) => e.elementId === elementId),
      );
      if (!ownerPage) {
        clientLogger.debug(
          "[editor] Remote update for unknown element — ignored:",
          elementId,
        );
        return;
      }
      const existing = ownerPage.elements.find(
        (e) => e.elementId === elementId,
      );
      if (!existing) return;
      // Merge shallow volontaire (même sémantique qu'updateElementInPage).
      // Cast sûr : les changes distants proviennent du même type discriminant
      // que l'élément d'origine (l'émetteur a envoyé l'élément modifié).
      const merged = {
        ...existing,
        ...changes,
        elementId: existing.elementId,
      } as Element;

      clientLogger.debug("[editor] Remote element updated:", elementId);

      updateElementInPage(elementId, merged);
      if (pages.indexOf(ownerPage) === currentPageIndex) {
        canvasHandle?.applyRemoteElementUpdate(merged);
      }
    },
    [pages, currentPageIndex, updateElementInPage, canvasHandle],
  );

  const handleRemoteElementDelete = useCallback(
    (data: SocketEventData["element:delete"]) => {
      if (data.client_id && data.client_id === socketClient.getClientId()) {
        return;
      }
      const elementId = data.element_id;
      if (!elementId) return;

      clientLogger.debug("[editor] Remote element deleted:", elementId);

      // Canvas d'abord : la méthode no-op si l'objet n'est pas rendu sur la
      // page affichée, et son garde interne empêche tout onElementRemoved
      // (donc aucune réémission ni queueDelete).
      canvasHandle?.applyRemoteElementDelete(elementId);
      deselectElement(elementId);
      removeElementFromPage(elementId);
    },
    [canvasHandle, deselectElement, removeElementFromPage],
  );

  useElementUpdates(
    documentId,
    handleRemoteElementCreate,
    handleRemoteElementUpdate,
    handleRemoteElementDelete,
  );

  // Ref pour le canvas (pour la position du curseur)
  const canvasRef = useRef<HTMLDivElement>(null);

  // Undo/Redo state via canvas handle
  const canUndo = canvasHandle?.canUndo() ?? false;
  const canRedo = canvasHandle?.canRedo() ?? false;

  // Éléments sélectionnés (sur la page active — = currentPage en mode page
  // unique, = page focalisée en mode continu).
  const selectedElements = useMemo(() => {
    if (!effectivePage) return [];
    return effectivePage.elements.filter((el) =>
      selectedElementIds.includes(el.elementId)
    );
  }, [effectivePage, selectedElementIds]);

  // Text-only subset, used by the toolbar's Word-like formatting cluster.
  const selectedTextElements = useMemo(
    () =>
      selectedElements.filter(
        (el): el is TextElement => el.type === "text",
      ),
    [selectedElements],
  );

  // === P7 — Édition (#83) : Rechercher/Remplacer + Presse-papiers + Format
  // painter. État local (additif). Le presse-papiers est en mémoire applicative
  // (pas l'OS) — copier/couper stocke des clones d'éléments, coller les ré-injecte
  // via handleElementAdded (scene graph + queue + bake). Le format painter
  // « ramasse » le style d'un texte sélectionné puis l'applique aux sélections
  // suivantes via handleElementUpdate.
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [clipboard, setClipboard] = useState<Element[]>([]);
  const [copiedFormat, setCopiedFormat] = useState<PaintableTextStyle | null>(
    null,
  );
  const canPaste = clipboard.length > 0;
  const formatPainterArmed = copiedFormat !== null;
  // Source valide du format painter : exactement un élément texte sélectionné.
  const canCopyFormat = useMemo(
    () => selectedElements.length === 1 && selectedElements[0]?.type === "text",
    [selectedElements],
  );

  // --- Champs de formulaire du document (mode Concevoir) -------------------
  // Liste plate ordonnée page par page : c'est l'ordre dans lequel les
  // champs seront bakés en AcroForm au save/export — soit l'ordre de
  // tabulation logique dans la plupart des lecteurs PDF.
  const designFields = useMemo(() => {
    const list: Array<{ element: FormFieldElement; pageIndex: number }> = [];
    pages.forEach((page, pageIndex) => {
      for (const el of page.elements) {
        if (el.type === "form_field") {
          list.push({ element: el, pageIndex });
        }
      }
    });
    return list;
  }, [pages]);

  // Noms de champs du document — validation d'unicité dans le panel
  // propriétés (les widgets radio d'un groupe partagent leur nom : le panel
  // exclut le nom courant).
  const allFieldNames = useMemo(
    () => designFields.map(({ element }) => element.fieldName),
    [designFields],
  );

  // Sélection d'un champ depuis la liste du FormsPanel : navigue vers sa
  // page puis le sélectionne (le properties panel suit).
  const handleDesignFieldSelect = useCallback(
    (elementId: string, pageIndex: number) => {
      const targetPage = pages[pageIndex];
      if (!targetPage) return;
      // navigateToPage focuses + scrolls the page (continuous) or moves the
      // single-page pointer; it clears the selection, so re-select after.
      if (pageIndex !== effectivePageIndex) navigateToPage(pageIndex, "center");
      selectElements([elementId], targetPage.pageId);
    },
    [pages, effectivePageIndex, navigateToPage, selectElements],
  );

  // Réordonnancement d'un champ dans l'ordre de bake. Limitation moteur
  // documentée : l'ordre de tabulation PDF étant l'ordre des /Annots de la
  // PAGE, le réordonnancement n'opère qu'entre champs d'une même page (un
  // swap inter-pages déplacerait physiquement le champ).
  const handleDesignFieldReorder = useCallback(
    (elementId: string, direction: "up" | "down") => {
      const index = designFields.findIndex(
        ({ element }) => element.elementId === elementId,
      );
      if (index < 0) return;
      const neighborIndex = direction === "up" ? index - 1 : index + 1;
      if (neighborIndex < 0 || neighborIndex >= designFields.length) return;
      const current = designFields[index]!;
      const neighbor = designFields[neighborIndex]!;
      if (current.pageIndex !== neighbor.pageIndex) return;

      const newPages = pages.map((page, pageIndex) => {
        if (pageIndex !== current.pageIndex) return page;
        const elements = [...page.elements];
        const ia = elements.findIndex(
          (el) => el.elementId === current.element.elementId,
        );
        const ib = elements.findIndex(
          (el) => el.elementId === neighbor.element.elementId,
        );
        if (ia < 0 || ib < 0) return page;
        [elements[ia], elements[ib]] = [elements[ib]!, elements[ia]!];
        return { ...page, elements };
      });
      replacePages(newPages);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [designFields, pages, replacePages, setDirty, saveWithPriority],
  );

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

  // Z-order: bring the selected element(s) to the front / send to the back.
  // The canvas persists the new stacking order via the scene graph (no PDF
  // binary reorder op exists in the engine — see EditorCanvasHandle docs).
  const handleBringToFront = useCallback(() => {
    for (const id of selectedElementIds) canvasHandle?.bringToFront(id);
    if (selectedElementIds.length > 0) {
      setDirty(true);
      saveWithPriority("debounced");
    }
  }, [canvasHandle, selectedElementIds, setDirty, saveWithPriority]);

  const handleSendToBack = useCallback(() => {
    for (const id of selectedElementIds) canvasHandle?.sendToBack(id);
    if (selectedElementIds.length > 0) {
      setDirty(true);
      saveWithPriority("debounced");
    }
  }, [canvasHandle, selectedElementIds, setDirty, saveWithPriority]);

  // Operations queue: records user-added/modified/deleted elements so the
  // save flow can apply them to the PDF binary before uploading. Without
  // this, edits only exist in the scene_graph (Redis) and vanish from the
  // PDF on reload.
  const { queueAdd, queueUpdate, queueDelete } = useOperationsStore(
    useShallow((s) => ({
      queueAdd: s.queueAdd,
      queueUpdate: s.queueUpdate,
      queueDelete: s.queueDelete,
    }))
  );

  const handleElementAdded = useCallback(
    async (element: Element) => {
      clientLogger.debug("[editor] Element added:", element);
      setDirty(true);
      const pageNumber = currentPageIndex + 1;

      // Mirror the new element into the local scene graph so properties
      // panel and selection lookups find it. Without this, Fabric objects
      // are selectable but the panel stays empty because selectedElements
      // is computed via currentPage.elements.filter().
      addElementToPage(currentPageIndex, element);

      // Auto-select the new element so its properties are immediately
      // visible — matches the UX of every real PDF editor.
      if (currentPage) {
        selectElements([element.elementId], currentPage.pageId);
      }

      // Record the op so the save flow can bake it into the PDF.
      queueAdd(pageNumber, element);

      // Émettre via WebSocket pour la collaboration. Émission directe via
      // socketClient (et non emitElementCreate du hook) : le récepteur a
      // besoin de page_number pour router l'élément vers la bonne page, or
      // l'enveloppe du hook ne transporte que l'élément. client_id
      // (anti-écho) est estampillé automatiquement par socketClient.emit ;
      // user_id est renseigné côté serveur (même contrat que le hook).
      if (documentId) {
        socketClient.emit("element:create", {
          document_id: documentId,
          element,
          user_id: "",
          page_number: pageNumber,
        });
      }

      // Persister l'élément dans le backend (scene graph Redis) avec retry
      // exponentiel — couvre les hiccups Redis/réseau transients sans
      // bloquer l'UI. Le PDF S3 est de toute façon savé en parallèle, donc
      // un échec définitif côté Redis ne perd pas l'élément (le bake S3
      // reste).
      if (documentId) {
        const apiElement = convertToApiElement(element);
        try {
          await withRetry(
            () => api.createElement(documentId, pageNumber, apiElement),
            {
              onAttemptFailed: (attempt, err) =>
                clientLogger.warn(
                  `[API] createElement attempt ${attempt} failed:`,
                  err,
                ),
            },
          );
          clientLogger.debug("[API] Element created in backend:", element.elementId);
        } catch (error) {
          clientLogger.error(
            "[API] createElement failed after retries — element will be persisted via PDF bake only:",
            error,
          );
        }
      }

      // Sauvegarder le PDF vers S3 (debounced: batch ajouts rapprochés)
      saveWithPriority("debounced");
    },
    [setDirty, saveWithPriority, documentId, currentPageIndex, queueAdd, addElementToPage, currentPage, selectElements]
  );

  const handleElementModified = useCallback(
    async (element: Element, oldBounds?: Element["bounds"]) => {
      clientLogger.debug("[editor] Element modified:", element);
      setDirty(true);
      const pageNumber = currentPageIndex + 1;

      // Mirror the update into the local scene graph (properties panel
      // reads from there, not from Fabric).
      updateElementInPage(element.elementId, element);

      // Queue update with the TRUE oldBounds (tracked by editor-canvas
      // before the modification). Without this, apply-elements clears
      // the new bounds region and the original PDF glyph stays visible
      // (texte dupliqué post-bake). Fallback to element.bounds only if
      // tracking missed (very first modification of a freshly-loaded
      // element with no init).
      queueUpdate(pageNumber, element, oldBounds ?? element.bounds);

      // Émettre via WebSocket pour la collaboration
      emitElementUpdate(element.elementId, element);

      // Mettre à jour l'élément dans le backend avec retry exponentiel.
      //
      // Note: parsed-only elements (read straight from the PDF, never
      // persisted Redis-side) return 404 here. That's expected and
      // non-fatal — the change still persists via the PDF bake on save.
      // The retry helper short-circuits 404 thanks to the .status attached
      // by api.request, and the catch logs at debug level for that case so
      // the console stays readable.
      if (documentId) {
        const updates = convertToApiElement(element);
        try {
          await withRetry(
            () => api.updateElement(documentId, element.elementId, updates),
            {
              onAttemptFailed: (attempt, err) => {
                const status = (err as { status?: number })?.status;
                if (status === 404) return; // expected for parsed elements
                clientLogger.warn(
                  `[API] updateElement attempt ${attempt} failed:`,
                  err,
                );
              },
            },
          );
          clientLogger.debug("[API] Element updated in backend:", element.elementId);
        } catch (error) {
          const status = (error as { status?: number })?.status;
          if (status === 404) {
            clientLogger.debug(
              "[API] updateElement: parsed element not in Redis — will persist via PDF bake",
              element.elementId,
            );
          } else {
            clientLogger.error(
              "[API] updateElement failed after retries — change will persist via PDF bake:",
              error,
            );
          }
        }
      }

      // Sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementUpdate, saveWithPriority, documentId, currentPageIndex, queueUpdate, updateElementInPage]
  );

  const handleElementRemoved = useCallback(
    async (elementId: string) => {
      clientLogger.debug("[editor] Element removed:", elementId);
      setDirty(true);
      deselectElement(elementId);
      const pageNumber = currentPageIndex + 1;

      // Best-effort bounds lookup before the element is gone. Thread the
      // engine run index (present on parsed text runs in the scene graph) so
      // apply-operations can fire the TRUE in-place removeElement instead of
      // redact+add. Undefined for added/non-text elements — the engine then
      // falls back to redact+add on its own.
      const removed = currentPage?.elements.find((e) => e.elementId === elementId);
      if (removed) {
        const removedIndex = (removed as { index?: number }).index;
        queueDelete(pageNumber, elementId as UUID, removed.bounds, removedIndex);
      }

      // Mirror the removal in the local scene graph so the Properties
      // panel + selection shrink accordingly.
      removeElementFromPage(elementId);

      // Émettre via WebSocket pour la collaboration
      emitElementDelete(elementId);

      // Supprimer l'élément du backend avec retry exponentiel
      if (documentId) {
        try {
          await withRetry(
            () => api.deleteElement(documentId, elementId),
            {
              onAttemptFailed: (attempt, err) =>
                clientLogger.warn(
                  `[API] deleteElement attempt ${attempt} failed:`,
                  err,
                ),
            },
          );
          clientLogger.debug("[API] Element deleted from backend:", elementId);
        } catch (error) {
          clientLogger.error(
            "[API] deleteElement failed after retries — deletion will persist via PDF bake:",
            error,
          );
        }
      }

      // Sauvegarder le PDF vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementDelete, saveWithPriority, documentId, deselectElement, currentPageIndex, currentPage, queueDelete, removeElementFromPage]
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

      // PARTIE 3 — resync visuel panel→canvas. Historiquement ce handler ne
      // touchait QUE le backend (websocket + api.updateElement + save) : ni
      // le scene graph local ni le canvas Fabric n'étaient mis à jour, donc
      // les éditions du panneau propriétés (single ET batch) n'étaient
      // visibles qu'au reload. Fix : merge shallow dans le scene graph
      // (même sémantique que le handler remote) PUIS ré-application sur le
      // canvas via applyLocalElementUpdate — la variante SANS garde de
      // sélection (les éléments du panel SONT sélectionnés) qui restaure la
      // sélection après le retire/re-crée.
      const ownerPage = pages.find((p) =>
        p.elements.some((e) => e.elementId === elementId),
      );
      const existing = ownerPage?.elements.find(
        (e) => e.elementId === elementId,
      );
      if (ownerPage && existing) {
        const merged = {
          ...existing,
          ...updates,
          elementId: existing.elementId,
        } as Element;
        updateElementInPage(elementId, merged);
        if (pages.indexOf(ownerPage) === currentPageIndex) {
          canvasHandle?.applyLocalElementUpdate(merged);
        }
        // Bake the panel edit into the PDF binary via the operations queue.
        // Panel edits don't go through the Fabric object:modified path
        // (applyLocalElementUpdate suppresses events), so they must be queued
        // explicitly. A content-only change (the text textarea) takes the
        // engine in-place replaceText path (the element carries its run
        // index); a style change falls back to redact+add over the original
        // bounds. queueUpdate coalesces repeated edits to the same element.
        queueUpdate(pages.indexOf(ownerPage) + 1, merged, existing.bounds);
      }

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
          await withRetry(
            () => api.updateElement(documentId, elementId, apiUpdates),
            {
              onAttemptFailed: (attempt, err) =>
                clientLogger.warn(
                  `[API] updateElement (panel) attempt ${attempt} failed:`,
                  err,
                ),
            },
          );
          clientLogger.debug("[API] Element updated in backend:", elementId);
        } catch (error) {
          clientLogger.error(
            "[API] updateElement (panel) failed after retries — change will persist via PDF bake:",
            error,
          );
        }
      }

      // Modification via panel propriétés → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [
      setDirty,
      emitElementUpdate,
      saveWithPriority,
      documentId,
      pages,
      currentPageIndex,
      updateElementInPage,
      canvasHandle,
      queueUpdate,
    ]
  );

  // === P7 — Presse-papiers (copier / couper / coller) =====================
  // Presse-papiers applicatif (mémoire React, pas l'OS). Copier/couper stocke
  // des snapshots des éléments sélectionnés ; coller clone avec offset et
  // ré-injecte via handleElementAdded (scene graph + queue apply-elements +
  // bake S3). Coller crée une NOUVELLE copie sélectionnée.
  const handleCopy = useCallback(() => {
    if (selectedElements.length === 0) {
      toast({ title: t("editTools.toasts.nothingSelected") });
      return;
    }
    // Snapshot détaché (deep clone) pour que des éditions ultérieures de la
    // source ne « contaminent » pas le presse-papiers.
    const snapshot = selectedElements.map(
      (el) => JSON.parse(JSON.stringify(el)) as Element,
    );
    setClipboard(snapshot);
    toast({
      title: t("editTools.toasts.copied", { count: snapshot.length }),
    });
  }, [selectedElements, toast, t]);

  const handleCut = useCallback(() => {
    if (selectedElements.length === 0) {
      toast({ title: t("editTools.toasts.nothingSelected") });
      return;
    }
    const snapshot = selectedElements.map(
      (el) => JSON.parse(JSON.stringify(el)) as Element,
    );
    setClipboard(snapshot);
    // Supprime via le flux d'édition existant (queueDelete + bake).
    for (const el of snapshot) {
      void handleElementRemoved(el.elementId);
    }
    toast({ title: t("editTools.toasts.cut", { count: snapshot.length }) });
  }, [selectedElements, handleElementRemoved, toast, t]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) {
      toast({ title: t("editTools.toasts.nothingToPaste") });
      return;
    }
    // Clone avec offset (fresh elementId, index moteur retiré) ; chaque clone
    // passe par handleElementAdded comme un élément utilisateur neuf.
    const clones = clonePastedElements(clipboard);
    for (const clone of clones) {
      void handleElementAdded(clone);
    }
    // handleElementAdded auto-sélectionne le dernier ; pour un coller multiple
    // on sélectionne l'ensemble des nouveaux éléments.
    if (currentPage && clones.length > 1) {
      selectElements(
        clones.map((c) => c.elementId),
        currentPage.pageId,
      );
    }
    toast({ title: t("editTools.toasts.pasted", { count: clones.length }) });
  }, [clipboard, handleElementAdded, currentPage, selectElements, toast, t]);

  // === P7 — Format painter (copier la mise en forme) ======================
  // Deux temps : (1) un seul élément texte sélectionné → ramasse son style
  // peignable. (2) Réarmé : applique le style copié à toutes les sélections
  // texte courantes via handleElementUpdate, puis désarme.
  const handleApplyCopiedFormat = useCallback(
    (paint: PaintableTextStyle) => {
      const targets = selectedElements.filter((el) => el.type === "text");
      if (targets.length === 0) {
        toast({ title: t("editTools.toasts.formatNoTarget") });
        return;
      }
      let applied = 0;
      for (const target of targets) {
        const nextStyle = applyPaintableStyle(target, paint);
        if (!nextStyle) continue;
        handleElementUpdate(target.elementId, {
          style: nextStyle,
        } as Partial<Element>);
        applied += 1;
      }
      toast({
        title: t("editTools.toasts.formatApplied", { count: applied }),
      });
    },
    [selectedElements, handleElementUpdate, toast, t],
  );

  const handleCopyFormat = useCallback(() => {
    // Réarmé → on applique puis on désarme.
    if (copiedFormat) {
      handleApplyCopiedFormat(copiedFormat);
      setCopiedFormat(null);
      return;
    }
    // Sinon → on ramasse le style de l'unique élément texte sélectionné.
    const source = selectedElements.length === 1 ? selectedElements[0] : null;
    const paint = source ? extractPaintableStyle(source) : null;
    if (!paint) {
      toast({ title: t("editTools.toasts.formatNotText") });
      return;
    }
    setCopiedFormat(paint);
    toast({ title: t("editTools.toasts.formatCopied") });
  }, [copiedFormat, handleApplyCopiedFormat, selectedElements, toast, t]);

  // === P7 — Rechercher / Remplacer ========================================
  // Navigation : va à la page de l'occurrence et sélectionne l'élément (le
  // panneau propriétés suit + l'élément est mis en évidence sur le canvas).
  const handleFindReplaceGoTo = useCallback(
    (occurrence: FindOccurrence) => {
      if (occurrence.pageIndex !== currentPageIndex) {
        goToPage(occurrence.pageIndex);
      }
      const targetPage = pages[occurrence.pageIndex];
      if (targetPage) {
        selectElements([occurrence.elementId], targetPage.pageId);
      }
    },
    [currentPageIndex, goToPage, pages, selectElements],
  );

  // Remplacer une occurrence : applique le nouveau contenu via le flux
  // d'édition existant (replaceText au bake).
  const handleReplaceOne = useCallback(
    (occurrence: FindOccurrence, newContent: string) => {
      handleElementUpdate(occurrence.elementId, {
        content: newContent,
      } as Partial<Element>);
      toast({ title: t("editTools.toasts.replacedOne") });
    },
    [handleElementUpdate, toast, t],
  );

  // Tout remplacer : un update par élément modifié.
  const handleReplaceAll = useCallback(
    (edits: { elementId: string; content: string }[]) => {
      for (const edit of edits) {
        handleElementUpdate(edit.elementId, {
          content: edit.content,
        } as Partial<Element>);
      }
      toast({
        title: t("editTools.toasts.replacedAll", { count: edits.length }),
      });
    },
    [handleElementUpdate, toast, t],
  );

  const handleFormatAction = useCallback(
    (action: ToolbarFormatAction) => {
      clientLogger.debug("[editor] Format action:", action);
      // Applique le formatage aux éléments texte sélectionnés sur le canvas.
      // Le canvas émet ensuite onElementModified pour chaque élément touché,
      // ce qui queue l'op apply-elements et synchronise le scene graph.
      canvasHandle?.applyTextFormat(TOOLBAR_FORMAT_TO_TEXT_FORMAT[action]);
      setDirty(true);
      // Modification de style → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [canvasHandle, setDirty, saveWithPriority]
  );

  // Word-like formatting bar → patch a single text style field. The bar emits
  // PARTIAL TextStyle patches (e.g. { fontWeight: "bold" }), so merge them into
  // the element's current style before handing off to handleElementUpdate
  // (which would otherwise shallow-replace the whole style object). Reuses the
  // existing canvas + bake + persist pipeline — no new save path.
  const handleTextStyleChange = useCallback(
    (elementId: string, style: Partial<TextStyle>) => {
      const ownerPage = pages.find((p) =>
        p.elements.some((e) => e.elementId === elementId),
      );
      const existing = ownerPage?.elements.find(
        (e) => e.elementId === elementId,
      ) as TextElement | undefined;
      if (!existing) return;
      handleElementUpdate(elementId, {
        style: { ...existing.style, ...style },
      } as Partial<Element>);
    },
    [pages, handleElementUpdate],
  );

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

      // 1. Apply pending canvas operations (text/shape/image overlays) so
      //    the binary contains the final scene-graph state, not just the
      //    parsed original.
      const canvasElements = currentPage?.elements ?? [];
      const canvasOps = canvasElements.map((el) => ({
        action: 'add' as const,
        pageNumber: currentPageIndex + 1,
        element: el as unknown as Record<string, unknown>,
      }));
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

      // 2. Flatten before export: bakes form fields + annotations into the
      //    page content so the exported PDF is self-contained. Avoids the
      //    "doublon d'élément" issue when interactive widgets, native PDF
      //    annotations and freshly baked overlays would otherwise coexist
      //    in the downloaded file.
      const blobToFlatten =
        fileToExport instanceof Blob ? fileToExport : new Blob([fileToExport]);
      const fileForFlatten = new File(
        [blobToFlatten],
        `${name || 'document'}.pdf`,
        { type: 'application/pdf' },
      );
      const flattenedBlob = await flattenPdf.mutateAsync({ file: fileForFlatten });

      downloadBlob(flattenedBlob, `${name || 'document'}.pdf`);
    } catch (err) {
      clientLogger.error('[editor] Export failed:', err);
      // Fall back to server download
      if (documentId) {
        window.open(api.getDocumentDownloadUrl(documentId), "_blank");
      }
    }
  }, [currentPdfFile, currentPage, currentPageIndex, contentModifications, applyElements, flattenPdf, name, documentId]);

  // Restore the document to its original (v1) PDF binary by asking the
  // backend to copy v1 forward as a new current version. This is the
  // canonical way to wipe duplicates accumulated by pre-3e13c33 saves
  // (Fabric IText overlays baked into the PDF on top of native glyphs).
  // The intermediate versions stay in version history — restore is non-
  // destructive. After the call we navigate the user to the same editor
  // route, which triggers a fresh /load that picks up the new current
  // version and re-parses the scene graph from scratch.
  const [restoring, setRestoring] = useState(false);
  const handleRestoreOriginal = useCallback(async () => {
    if (!storedDocumentId) {
      clientLogger.warn("[editor] Restore-original requires a storedDocumentId");
      return;
    }
    if (
      !confirm(
        "Restaurer la version originale (v1) du document ? " +
          "Vos modifications actuelles seront archivées dans l'historique " +
          "des versions et le document repartira de l'état d'origine."
      )
    ) {
      return;
    }
    setRestoring(true);
    try {
      const result = await api.restoreOriginalDocument(storedDocumentId);
      clientLogger.info("[editor] Document restored to v1:", result);
      // Hard reload so /load is called fresh against the new current
      // version. Soft router.refresh() would keep the in-memory session
      // PDF and elements stale.
      window.location.reload();
    } catch (err) {
      clientLogger.error("[editor] Restore-original failed:", err);
      toast({
        variant: "destructive",
        title: t("error.restoreFailed"),
      });
      setRestoring(false);
    }
  }, [storedDocumentId, toast, t]);

  const handleFlattenPdf = async () => {
    if (!currentPdfFile) return;
    try {
      const blob = await flattenPdf.mutateAsync({ file: currentPdfFile });
      downloadBlob(blob, "flattened.pdf");
    } catch (error) {
      clientLogger.error("[editor] Flatten failed:", error);
    }
  };

  // Export Office (DOCX/PPTX via libreoffice headless, XLSX via extraction custom).
  // Sauvegarde d'abord le document courant pour exporter l'état le plus récent
  // côté serveur, puis appelle /api/office/export qui retourne le binaire Office.
  const [exportingOfficeFormat, setExportingOfficeFormat] = useState<
    "docx" | "xlsx" | "pptx" | null
  >(null);
  // Backend (Celery) export for raster/text/html formats — png/jpeg/webp/txt/html.
  const [exportingFormat, setExportingFormat] = useState<
    "png" | "jpeg" | "webp" | "txt" | "html" | null
  >(null);
  // Universal export via the GigaPDF SDK (#84) — lowers the CURRENT document
  // (currentPdfFile, the WYSIWYG source of truth) into any editable office /
  // OpenDocument / web format, 100% client-side. Independent of the two
  // server-side export paths above; null when no SDK export is running.
  const [exportingModelFormat, setExportingModelFormat] =
    useState<ExportFormat | null>(null);
  const handleExportOffice = useCallback(
    async (format: "docx" | "xlsx" | "pptx") => {
      if (!documentId || exportingOfficeFormat) return;
      setExportingOfficeFormat(format);
      try {
        // Garantit que la version exportée reflète l'état courant
        if (isDirty) await save();
        const token = await getAuthToken();
        const res = await fetch("/api/office/export", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ documentId, format }),
        });
        if (!res.ok) {
          throw new Error(`Export ${format} failed: HTTP ${res.status}`);
        }
        const blob = await res.blob();
        // Filename depuis Content-Disposition si présent, sinon fallback
        const cd = res.headers.get("Content-Disposition") ?? "";
        const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        const filename = cdMatch?.[1]
          ? decodeURIComponent(cdMatch[1].replace(/"/g, ""))
          : `document.${format}`;
        downloadBlob(blob, filename);
      } catch (err) {
        clientLogger.error(`[editor] Office export ${format} failed:`, err);
      } finally {
        setExportingOfficeFormat(null);
      }
    },
    [documentId, exportingOfficeFormat, isDirty, save],
  );

  // Export via the backend (Celery) pipeline for raster/text/html formats.
  // Image / text / html export, entirely client-side from the CURRENT document
  // (currentPdfFileRef — the WYSIWYG source of truth, cf. pdf-libraries rule), so
  // the result reflects unsaved edits with no backend job. Images come back as a
  // .zip of per-page files; txt/html as their own file. Persists to the server
  // first (best-effort) so the stored copy stays in sync, but the export reads
  // the local bytes regardless.
  const handleExportFormat = useCallback(
    async (format: "png" | "jpeg" | "webp" | "txt" | "html") => {
      const file = currentPdfFileRef.current;
      if (!file || exportingFormat) return;
      setExportingFormat(format);
      try {
        if (isDirty) await save();
        const bytes = new Uint8Array(await file.arrayBuffer());
        let blob: Blob;
        let ext: string;
        if (format === "png" || format === "jpeg" || format === "webp") {
          blob = await exportPagesAsImages(bytes, format, {
            dpi: 150,
            quality: 85,
          });
          ext = "zip";
        } else if (format === "txt") {
          const text = await extractDocumentText(bytes);
          blob = new Blob([text], { type: "text/plain;charset=utf-8" });
          ext = "txt";
        } else {
          blob = await exportDocumentAs(bytes, "html");
          ext = "html";
        }
        downloadBlob(blob, `${name || "document"}.${ext}`);
        toast({ title: t("office.exportSuccess") });
      } catch (err) {
        clientLogger.error(`[editor] export ${format} failed:`, err);
        toast({ title: t("office.exportError"), variant: "destructive" });
      } finally {
        setExportingFormat(null);
      }
    },
    [exportingFormat, isDirty, save, name, toast, t],
  );

  // Universal export (#84): lower the CURRENT document into any editable
  // format (docx/xlsx/pptx/odt/ods/odp/html/rtf/pdf) via the GigaPDF SDK,
  // entirely client-side. Exports from currentPdfFileRef — the WYSIWYG source
  // of truth (cf. pdf-libraries rule) — so the result reflects unsaved edits
  // without a server round-trip. Read-only: never touches the scene graph.
  const handleExportModel = useCallback(
    async (format: ExportFormat) => {
      const file = currentPdfFileRef.current;
      if (!file || exportingModelFormat) return;
      setExportingModelFormat(format);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const blob = await exportDocumentAs(bytes, format);
        downloadBlob(blob, exportFilename(name || file.name, format));
        toast({
          title: t("office.exportSuccess"),
        });
      } catch (err) {
        clientLogger.error(`[editor] SDK export ${format} failed:`, err);
        toast({
          title: t("office.exportError"),
          variant: "destructive",
        });
      } finally {
        setExportingModelFormat(null);
      }
    },
    [exportingModelFormat, name, toast, t],
  );

  // Re-parse the PDF binary to refresh the scene graph after a page op.
  // After rotate/add/delete/move, the text items keep their original
  // coordinates in the parse output — but the page dimensions / rotation
  // flag have changed, so the canvas lays everything out wrong. Calling
  // /api/pdf/parse with the fresh binary returns new bounds that match
  // the new geometry, fixing the 'text piled up' symptom.
  const reparseFromFile = useCallback(
    async (file: File): Promise<void> => {
      try {
        const { getAuthToken } = await import('@/lib/api');
        const token = await getAuthToken();
        const form = new FormData();
        form.append('file', file, file.name);
        const res = await fetch('/api/pdf/parse', {
          method: 'POST',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!res.ok) {
          clientLogger.warn('[editor] re-parse failed:', res.status);
          return;
        }
        const json = (await res.json()) as { success: boolean; data?: { pages?: unknown[] } };
        const pages = json?.data?.pages;
        if (Array.isArray(pages)) {
          replacePages(pages as PageObject[]);
        }
      } catch (err) {
        clientLogger.error('[editor] re-parse threw:', err);
      }
    },
    [replacePages],
  );

  // Shared post-processing for any operation that produced a full
  // replacement PDF binary (page ops, watermark, …): swap the in-memory
  // binary, mark the document dirty, trigger an immediate save, and
  // (optionally) re-parse so the scene graph matches the new layout.
  //
  // When `reparse` is true (default), the PDF is re-parsed after the op so
  // the scene graph reflects the new layout. Set to false for ops that
  // don't change element coordinates.
  const adoptModifiedPdf = useCallback(
    (blob: Blob, opts: { reparse?: boolean } = {}): File | null => {
      const file = currentPdfFileRef.current;
      if (!file) return null;
      const newFile = new File([blob], file.name, {
        type: 'application/pdf',
      });
      updateCurrentPdfFile(newFile);
      setDirty(true);
      saveWithPriority('immediate');
      // Refresh the scene graph from the new binary so the canvas
      // re-renders text items at the correct new bounds.
      if (opts.reparse !== false) {
        void reparseFromFile(newFile);
      }
      return newFile;
    },
    [setDirty, saveWithPriority, updateCurrentPdfFile, reparseFromFile],
  );

  // Shared helper: run a page-level op through /api/pdf/pages, swap the
  // binary in memory, and trigger an immediate save. Returns the new file
  // so callers can run extra local-state updates (duplicate/add/delete need
  // to mirror the scene graph) in the same tick.
  const runPageOperation = useCallback(
    async (
      operation: 'add' | 'copy' | 'rotate' | 'delete' | 'move',
      params: Record<string, unknown>,
      opts: { reparse?: boolean } = {},
    ): Promise<File | null> => {
      const file = currentPdfFileRef.current;
      if (!file) return null;
      try {
        const result = await pageOperation.mutateAsync({
          file,
          operation,
          params,
        });
        return adoptModifiedPdf(result as Blob, opts);
      } catch (err) {
        clientLogger.error(`[editor] ${operation} page failed:`, err);
        return null;
      }
    },
    [pageOperation, adoptModifiedPdf],
  );

  // Commit new page margins (PDF points) dropped from a ruler/guide drag. The
  // GigaPDF engine insets the page's CropBox client-side, producing new bytes
  // that we adopt exactly like a page op (swap binary + save + re-parse so the
  // editable overlay re-aligns to the new page box).
  const handleMarginsCommit = useCallback(
    (pageIndex: number, margins: PageMargins) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const next = await applyPageMargins(bytes, pageIndex, margins);
          // `next` is a fresh Uint8Array backed by its own ArrayBuffer.
          adoptModifiedPdf(new Blob([next], { type: "application/pdf" }));
        } catch (err) {
          clientLogger.error("[editor] set page margins failed:", err);
          toast({
            title: t("rulers.marginErrorTitle"),
            description: t("rulers.marginErrorDescription"),
            variant: "destructive",
          });
        }
      })();
    },
    [adoptModifiedPdf, toast, t],
  );

  // Bake a Word-style running header/footer onto the current PDF. The GigaPDF
  // engine draws the band text (with {{page}}/{{pages}} tokens) in the top/
  // bottom margin band, producing new bytes we adopt without re-parsing — the
  // band lives outside the page content, so the editable overlay is unchanged.
  const handleHeaderFooterApply = useCallback(
    (kind: HeaderFooterKind, spec: HeaderFooterSpec) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        setHeaderFooterBusy(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const next = await applyHeaderFooter(bytes, kind, spec);
          adoptModifiedPdf(new Blob([next], { type: "application/pdf" }), {
            reparse: false,
          });
          toast({
            title: t("headersFooters.appliedTitle"),
            description: t("headersFooters.appliedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] set header/footer failed:", err);
          toast({
            title: t("headersFooters.errorTitle"),
            description: t("headersFooters.errorDescription"),
            variant: "destructive",
          });
        } finally {
          setHeaderFooterBusy(false);
        }
      })();
    },
    [adoptModifiedPdf, toast, t],
  );

  // Remove every header (or footer) band of the current PDF, adopting the new
  // bytes without re-parsing (the page content is unchanged).
  const handleHeaderFooterRemove = useCallback(
    (kind: HeaderFooterKind) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        setHeaderFooterBusy(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const next = await removeHeaderFooter(bytes, kind);
          adoptModifiedPdf(new Blob([next], { type: "application/pdf" }), {
            reparse: false,
          });
          toast({
            title: t("headersFooters.removedTitle"),
            description: t("headersFooters.removedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] remove header/footer failed:", err);
          toast({
            title: t("headersFooters.errorTitle"),
            description: t("headersFooters.errorDescription"),
            variant: "destructive",
          });
        } finally {
          setHeaderFooterBusy(false);
        }
      })();
    },
    [adoptModifiedPdf, toast, t],
  );

  // Toggle Word-style headers & footers for the document. Turning the feature
  // OFF clears both bands from the PDF; turning it ON just flips the flag (the
  // dialog drives the actual band apply). Mirrors the watermark/compress flow.
  const handleToggleHeadersFooters = useCallback(() => {
    if (headersFootersEnabled) {
      // Going OFF: strip both bands, then drop the flag.
      const file = currentPdfFileRef.current;
      setHeadersFootersEnabled(false);
      if (!file) return;
      void (async () => {
        setHeaderFooterBusy(true);
        try {
          let bytes = new Uint8Array(await file.arrayBuffer());
          bytes = await removeHeaderFooter(bytes, "header");
          bytes = await removeHeaderFooter(bytes, "footer");
          adoptModifiedPdf(new Blob([bytes], { type: "application/pdf" }), {
            reparse: false,
          });
        } catch (err) {
          clientLogger.error("[editor] clear headers/footers failed:", err);
        } finally {
          setHeaderFooterBusy(false);
        }
      })();
    } else {
      toggleHeadersFooters();
    }
  }, [
    headersFootersEnabled,
    setHeadersFootersEnabled,
    toggleHeadersFooters,
    adoptModifiedPdf,
  ]);

  // Filigrane appliqué au document courant (mode « Appliquer au document »
  // du WatermarkDialog) : adopte le binaire filigrané exactement comme une
  // opération de page (swap binaire + re-parse + save immédiat), puis
  // confirme via toast.
  const handleWatermarkApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob);
      if (!adopted) return;
      toast({
        title: t("watermark.appliedTitle"),
        description: t("watermark.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  // Compression appliquée au document courant (mode « Appliquer au
  // document » du CompressDialog) : swap du binaire + save immédiat. Pas de
  // re-parse — la compression ne change ni la géométrie ni le contenu des
  // pages, seulement la sérialisation des objets PDF.
  const handleCompressApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob, { reparse: false });
      if (!adopted) return;
      toast({
        title: t("compress.appliedTitle"),
        description: t("compress.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  // OCR « PDF cherchable » appliqué : le binaire contient désormais un
  // calque de texte invisible — re-parse (défaut) pour que le scene graph
  // (et la recherche côté éditeur) voient les nouveaux items de texte.
  const handleOcrApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob);
      if (!adopted) return;
      toast({
        title: t("ocr.appliedTitle"),
        description: t("ocr.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  // Apply the PII redaction zones drawn on the active page. The zones are
  // transient canvas markers (read off the canvas handle in web coordinates);
  // we tag them with the active page number, lower them to PDF user-space via
  // the page's displayed dimensions + rotation, and hand them to the engine's
  // redactPii (deletes overlapping text, overwrites image pixels, paints an
  // opaque black box — irreversibly). The new binary is adopted exactly like a
  // page op (swap binary + re-parse so the editable overlay re-aligns) and the
  // markers are cleared.
  const handleRedactApply = useCallback(() => {
    const file = currentPdfFileRef.current;
    const page = effectivePage;
    if (!file || !page || !canvasHandle) return;
    const marks = canvasHandle.getRedactionMarks();
    if (marks.length === 0) return;

    const pageNumber = effectivePageIndex + 1; // engine pages are 1-based
    const webRects: WebRedactionRect[] = marks.map((m) => ({
      ...m,
      pageNumber,
    }));
    const geometries = new Map<number, PageGeometry>([
      [
        pageNumber,
        {
          width: page.dimensions.width,
          height: page.dimensions.height,
          rotation: page.dimensions.rotation as 0 | 90 | 180 | 270,
        },
      ],
    ]);
    const rectsByPage = groupRectsByPage(webRects, geometries);
    if (rectsByPage.size === 0) return;

    void (async () => {
      setRedactBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { bytes: next } = await redactDocument(bytes, rectsByPage);
        adoptModifiedPdf(new Blob([next], { type: "application/pdf" }));
        canvasHandle.clearRedactionMarks();
        setRedactionMarkCount(0);
        toast({
          title: t("redact.appliedTitle"),
          description: t("redact.appliedDescription"),
        });
      } catch (err) {
        clientLogger.error("[editor] redaction failed:", err);
        toast({
          title: t("redact.errorTitle"),
          description: t("redact.errorDescription"),
          variant: "destructive",
        });
      } finally {
        setRedactBusy(false);
      }
    })();
  }, [
    adoptModifiedPdf,
    canvasHandle,
    effectivePage,
    effectivePageIndex,
    toast,
    t,
  ]);

  // Discard every redaction zone drawn on the active page without applying.
  const handleRedactClear = useCallback(() => {
    canvasHandle?.clearRedactionMarks();
    setRedactionMarkCount(0);
  }, [canvasHandle]);

  // On-demand OCR + semantic indexing of the document (#85). Runs OCR on the
  // in-memory PDF blob (single source of truth), then ships the resulting
  // blocks to the backend pgvector index. The whole document is indexed because
  // the backend ingestion REPLACES the document's index — sending one page
  // would drop the others. Non-blocking UI: a busy flag disables the button.
  const handleIndexOcr = useCallback(() => {
    const pdfFile = currentPdfFileRef.current;
    if (!pdfFile || !storedDocumentId) return;

    void (async () => {
      setIndexOcrBusy(true);
      try {
        const token = await getAuthToken();
        const form = new FormData();
        form.append("file", pdfFile, pdfFile.name);
        // `page` omitted → OCR every page (full, consistent index).
        form.append("granularity", "line");

        const res = await fetch("/api/pdf/ocr-page", {
          method: "POST",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!res.ok) {
          throw new Error(`OCR route returned ${res.status}`);
        }
        const data = (await res.json()) as {
          success: boolean;
          blocks: Array<{
            page: number;
            text: string;
            bbox: { x: number; y: number; w: number; h: number };
          }>;
        };
        const blocks = data.blocks ?? [];
        if (blocks.length === 0) {
          toast({
            title: t("indexOcr.emptyTitle"),
            description: t("indexOcr.emptyDescription"),
          });
          return;
        }

        const result = await api.indexOcrBlocks(storedDocumentId, blocks);
        if (!result.semantic_search_available) {
          toast({
            title: t("indexOcr.unavailableTitle"),
            description: t("indexOcr.unavailableDescription"),
          });
          return;
        }
        toast({
          title: t("indexOcr.indexedTitle"),
          description: t("indexOcr.indexedDescription", {
            count: result.blocks_indexed,
          }),
        });
      } catch (err) {
        clientLogger.error("[editor] OCR index failed:", err);
        toast({
          title: t("indexOcr.errorTitle"),
          description: t("indexOcr.errorDescription"),
          variant: "destructive",
        });
      } finally {
        setIndexOcrBusy(false);
      }
    })();
  }, [storedDocumentId, toast, t]);

  // Signature numérique appliquée au document courant (mode « Appliquer au
  // document » du SignDialog) : swap du binaire + save immédiat. Pas de
  // re-parse — la signature n'ajoute qu'un dictionnaire /Sig invisible, la
  // géométrie des pages est inchangée. Toute modification ultérieure du
  // binaire invaliderait la signature : on n'y touche plus.
  const handleSignApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob, { reparse: false });
      if (!adopted) return;
      toast({
        title: t("sign.appliedTitle"),
        description: t("sign.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  const handlePageRotate = useCallback(
    (pageIndex: number) =>
      runPageOperation('rotate', { pageNumber: pageIndex + 1, degrees: 90 }),
    [runPageOperation],
  );

  const handleAddPage = useCallback(async () => {
    // afterPage=pages.length inserts at the end. pdf-engine treats it as
    // 1-indexed insertion point, so we pass the current page count as-is.
    const ok = await runPageOperation('add', { afterPage: pages.length });
    if (ok) addPageLocal();
  }, [runPageOperation, pages.length, addPageLocal]);

  // --- Insert menu (Word-like) ------------------------------------------------

  /**
   * Insert an `rows`×`cols` table at the current page. The model has no grouped
   * table primitive, so the table is laid out as individual editable text cells
   * + `line` border shapes within the page content area (page size minus a
   * margin). Each element flows through the SAME element-add pipeline used by
   * the canvas tools (`handleElementAdded`): scene-graph mirror + queue + bake.
   */
  const handleInsertTable = useCallback(
    async (rows: number, cols: number) => {
      const page = currentPage;
      if (!page) return;
      const { width, height } = page.dimensions;
      // 10% margin (clamped) keeps the grid clear of page edges.
      const marginX = Math.min(width * 0.1, 72);
      const marginY = Math.min(height * 0.1, 72);
      const elements = buildTableElements({
        rows,
        cols,
        area: {
          x: marginX,
          y: marginY,
          width: Math.max(width - marginX * 2, 1),
          height: Math.max(height - marginY * 2, 1),
        },
      });
      // Add cells + borders sequentially through the normal add path. Each call
      // assigns a fresh elementId, mirrors to the scene graph, queues the op and
      // schedules a debounced save (batched across the rapid sequence).
      for (const el of elements) {
        await handleElementAdded({
          ...el,
          elementId: `element-${Date.now()}-${Math.random()}`,
        } as Element);
      }
    },
    [currentPage, handleElementAdded],
  );

  /**
   * Attach a hyperlink (external URL or in-document page) to the single
   * selected text element. TextElement carries `linkUrl` / `linkPage`; the
   * change persists via the existing partial-update path (`handleElementUpdate`)
   * — no new save path.
   */
  const handleInsertLink = useCallback(
    (value: InsertLinkValue) => {
      const target = selectedTextElements[0];
      if (!target) return;
      const updates: Partial<TextElement> =
        value.kind === "url"
          ? { linkUrl: value.url, linkPage: null }
          : { linkUrl: null, linkPage: value.page };
      handleElementUpdate(target.elementId, updates as Partial<Element>);
    },
    [selectedTextElements, handleElementUpdate],
  );

  /** Remove the hyperlink from the selected text element. */
  const handleRemoveLink = useCallback(() => {
    const target = selectedTextElements[0];
    if (!target) return;
    handleElementUpdate(target.elementId, {
      linkUrl: null,
      linkPage: null,
    } as Partial<Element>);
  }, [selectedTextElements, handleElementUpdate]);

  /**
   * Insert a blank page before / after the current page, reusing the page-op
   * pipeline (`runPageOperation('add', …)`) — the same one the page sidebar uses.
   * pdf-engine treats `afterPage` as a 1-indexed insertion point; the current
   * 0-indexed page index maps to "after the current page", and one less maps to
   * "before".
   */
  const handleInsertBlankPage = useCallback(
    async (position: "before" | "after") => {
      const idx = effectivePageIndex;
      const afterPage = position === "after" ? idx : idx - 1;
      const ok = await runPageOperation("add", { afterPage });
      if (!ok) return;
      addPageLocal();
      // Inserting before the current page shifts it down by one — follow it so
      // the user stays on the same content.
      if (position === "before") {
        goToPage(idx + 1);
      }
    },
    [effectivePageIndex, runPageOperation, addPageLocal, goToPage],
  );

  /**
   * Apply bullet / numbered list formatting to the selected text element by
   * prefixing each line of its content. Persists via the partial-update path
   * (content change → in-place replaceText bake).
   */
  const handleInsertList = useCallback(
    (kind: "bullet" | "numbered") => {
      const target = selectedTextElements[0];
      if (!target) return;
      const next = buildListContent(target.content, kind);
      if (next === target.content) return;
      handleElementUpdate(target.elementId, {
        content: next,
      } as Partial<Element>);
    },
    [selectedTextElements, handleElementUpdate],
  );

  const handleDuplicatePage = useCallback(
    async (pageIndex: number) => {
      const ok = await runPageOperation('copy', {
        pageNumber: pageIndex + 1,
        insertAfter: pageIndex + 1,
      });
      if (ok) duplicatePageLocal(pageIndex);
    },
    [runPageOperation, duplicatePageLocal],
  );

  const handleDeletePage = useCallback(
    async (pageIndex: number) => {
      // pdf-engine refuses to delete the last remaining page; guard locally.
      if (pages.length <= 1) return;
      const ok = await runPageOperation('delete', { pageNumber: pageIndex + 1 });
      if (ok) deletePageLocal(pageIndex);
    },
    [runPageOperation, pages.length, deletePageLocal],
  );

  const handleReorderPages = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const ok = await runPageOperation('move', {
        fromPage: fromIndex + 1,
        toPage: toIndex + 1,
      });
      if (ok) reorderPagesLocal(fromIndex, toIndex);
    },
    [runPageOperation, reorderPagesLocal],
  );

  const handlePageExtract = useCallback(async (pageIndex: number) => {
    if (!currentPdfFile) return;
    try {
      const result = await pageOperation.mutateAsync({
        file: currentPdfFile,
        operation: 'extract',
        params: { pageNumbers: [pageIndex + 1] },
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

  // Handler pour la navigation TOC. pageNumber is 1-indexed; navigateToPage
  // expects 0-indexed and scrolls the page into view in continuous mode.
  const handleNavigateToPage = useCallback((pageNumber: number) => {
    navigateToPage(pageNumber - 1, "start");
  }, [navigateToPage]);

  // Handler pour la visibilité d'un calque (= élément de la page).
  // Décision produit : le masquage est un OUTIL D'ÉDITION uniquement — un
  // élément masqué reste dans le scene graph ET dans le PDF baké au save
  // (aucun queueUpdate ici : pas de redaction, pas de réécriture du PDF).
  // Le panneau calques étant contrôlé par element.visible, la mise à jour
  // du scene graph suffit à rafraîchir l'icône œil ; le renderer du canvas
  // ré-applique l'état au prochain loadPage (navigation de page).
  const handleElementVisibilityChange = useCallback(
    (elementId: string, visible: boolean) => {
      clientLogger.debug(
        "[editor] Element visibility changed:",
        elementId,
        visible,
      );
      // 1. Canvas Fabric (effet visuel immédiat, désélection si masqué)
      canvasHandle?.setElementVisibility(elementId, visible);
      // 2. Scene graph React (source de vérité du panel + des re-renders)
      updateElementInPage(elementId, { visible });
      // 3. Collaboration : payload partiel — le récepteur merge sur
      //    l'élément connu puis re-rend l'objet Fabric (état appliqué).
      emitElementUpdate(elementId, { visible });
      setDirty(true);
      saveWithPriority("debounced");
    },
    [canvasHandle, updateElementInPage, emitElementUpdate, setDirty, saveWithPriority],
  );

  // Handler pour le verrouillage d'un calque (= élément de la page).
  // Verrouillé = non sélectionnable/non éditable sur le canvas
  // (selectable=false, evented=false). Même contrat de sync que la
  // visibilité : pas d'op PDF, état persisté dans le scene graph.
  const handleElementLockChange = useCallback(
    (elementId: string, locked: boolean) => {
      clientLogger.debug("[editor] Element lock changed:", elementId, locked);
      canvasHandle?.setElementLocked(elementId, locked);
      updateElementInPage(elementId, { locked });
      emitElementUpdate(elementId, { locked });
      setDirty(true);
      saveWithPriority("debounced");
    },
    [canvasHandle, updateElementInPage, emitElementUpdate, setDirty, saveWithPriority],
  );

  // Sélectionner un élément depuis le panneau calques : le canvas le passe en
  // objet actif et forwarde la sélection au store + panneau propriétés. Pas de
  // mutation ni de save — purement une sélection (comme un clic sur le canvas).
  const handleSelectElementFromLayer = useCallback(
    (elementId: string) => {
      canvasHandle?.selectElement(elementId);
    },
    [canvasHandle],
  );

  // ── User layers (Phase 2 "Layer Groups") ─────────────────────────────────
  // Editor-only construct: layer membership + visibility/lock live in the
  // scene graph (useDocument), NOT in the PDF (no OCG, no pdf-engine op). The
  // visibility/lock cascade is applied to member elements inside useDocument
  // in a single state pass; here we additionally mirror the visual effect onto
  // the Fabric canvas + collaboration for each currently-loaded member element.
  const handleLayerCreate = useCallback(() => {
    // Default name is a simple ordinal; the panel immediately enters rename
    // mode after creation (double-click is also available afterwards).
    createLayer(`Layer ${userLayers.length + 1}`);
    setDirty(true);
    saveWithPriority("debounced");
  }, [createLayer, userLayers.length, setDirty, saveWithPriority]);

  const handleLayerDelete = useCallback(
    (layerId: string) => {
      deleteLayer(layerId);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [deleteLayer, setDirty, saveWithPriority],
  );

  const handleLayerRename = useCallback(
    (layerId: string, name: string) => {
      renameLayer(layerId, name);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [renameLayer, setDirty, saveWithPriority],
  );

  const handleLayerReorder = useCallback(
    (layerId: string, newOrder: number) => {
      reorderLayer(layerId, newOrder);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [reorderLayer, setDirty, saveWithPriority],
  );

  const handleLayerVisibilityChange = useCallback(
    (layerId: string, visible: boolean) => {
      // Cascade member element flags in the scene graph (single pass).
      setLayerVisible(layerId, visible);
      // Mirror onto canvas + collaboration for each loaded member element.
      const members = (effectivePage?.elements ?? []).filter(
        (el) => el.layerId === layerId,
      );
      for (const el of members) {
        canvasHandle?.setElementVisibility(el.elementId, visible);
        emitElementUpdate(el.elementId, { visible });
      }
      setDirty(true);
      saveWithPriority("debounced");
    },
    [
      setLayerVisible,
      effectivePage,
      canvasHandle,
      emitElementUpdate,
      setDirty,
      saveWithPriority,
    ],
  );

  const handleLayerLockChange = useCallback(
    (layerId: string, locked: boolean) => {
      setLayerLocked(layerId, locked);
      const members = (effectivePage?.elements ?? []).filter(
        (el) => el.layerId === layerId,
      );
      for (const el of members) {
        canvasHandle?.setElementLocked(el.elementId, locked);
        emitElementUpdate(el.elementId, { locked });
      }
      setDirty(true);
      saveWithPriority("debounced");
    },
    [
      setLayerLocked,
      effectivePage,
      canvasHandle,
      emitElementUpdate,
      setDirty,
      saveWithPriority,
    ],
  );

  const handleAssignElementToLayer = useCallback(
    (elementId: string, layerId: string | null) => {
      assignElementToLayer(elementId, layerId);
      emitElementUpdate(elementId, { layerId });
      setDirty(true);
      saveWithPriority("debounced");
    },
    [assignElementToLayer, emitElementUpdate, setDirty, saveWithPriority],
  );

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
      // Un lien provient du PDF (source non fiable) : n'ouvrir QUE du http(s).
      // Bloque les schemes dangereux (javascript:, data:, file:…) → anti-XSS,
      // + noopener,noreferrer pour couper l'accès à window.opener.
      try {
        const parsed = new URL(linkUrl, window.location.href);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          window.open(parsed.toString(), "_blank", "noopener,noreferrer");
        } else {
          clientLogger.warn("[editor] Blocked non-http(s) hyperlink", parsed.protocol);
        }
      } catch {
        clientLogger.warn("[editor] Invalid hyperlink URL", linkUrl);
      }
    } else if (linkPage) {
      navigateToPage(linkPage - 1, "start"); // linkPage is 1-indexed
    }
  }, [navigateToPage]);

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
        toast({
          variant: "destructive",
          title: t("error.invalidImageType"),
        });
        return;
      }

      // Vérifier la taille (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          variant: "destructive",
          title: t("error.imageTooLarge"),
        });
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
    [t, toast, canvasHandle, setDirty, saveWithPriority]
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

      // Ctrl/Cmd + ] - Bring selection to front (z-order)
      if (cmdOrCtrl && e.key === "]") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleBringToFront();
        }
        return;
      }

      // Ctrl/Cmd + [ - Send selection to back (z-order)
      if (cmdOrCtrl && e.key === "[") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleSendToBack();
        }
        return;
      }

      // Ctrl/Cmd + F - Find & replace
      if (cmdOrCtrl && e.key === "f") {
        e.preventDefault();
        setFindReplaceOpen(true);
        return;
      }

      // Ctrl/Cmd + C - Copy selection to the app clipboard (only when elements
      // are selected; otherwise leave native text copy alone).
      if (cmdOrCtrl && e.key === "c") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleCopy();
        }
        return;
      }

      // Ctrl/Cmd + X - Cut selection.
      if (cmdOrCtrl && e.key === "x") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleCut();
        }
        return;
      }

      // Ctrl/Cmd + V - Paste the app clipboard.
      if (cmdOrCtrl && e.key === "v") {
        if (clipboard.length > 0) {
          e.preventDefault();
          handlePaste();
        }
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

      // Page navigation — PageDown/PageUp always, ArrowDown/ArrowUp only when
      // nothing is selected (so arrows still nudge a selected element). Routes
      // through navigateToPage → scrolls into view in continuous mode.
      const noSelection = selectedElementIds.length === 0;
      if (e.key === "PageDown" || (e.key === "ArrowDown" && noSelection)) {
        e.preventDefault();
        navigateToPage(effectivePageIndex + 1, "start");
        return;
      }
      if (e.key === "PageUp" || (e.key === "ArrowUp" && noSelection)) {
        e.preventDefault();
        navigateToPage(effectivePageIndex - 1, "start");
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

      // Zoom shortcuts — pas multiplicatifs fluides (×1.25), clampés par le
      // store. Ctrl+0 = ajuster la page (mode fit, recalculé au resize),
      // Ctrl+1 = 100 % (zoom manuel → sort du mode fit).
      if (cmdOrCtrl) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          handleManualZoomChange(zoom * 1.25);
        } else if (e.key === "-") {
          e.preventDefault();
          handleManualZoomChange(zoom / 1.25);
        } else if (e.key === "0") {
          e.preventDefault();
          handleFitPage();
        } else if (e.key === "1") {
          e.preventDefault();
          handleManualZoomChange(1);
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
    handleBringToFront,
    handleSendToBack,
    handleAddImage,
    save,
    selectedElementIds,
    zoom,
    clearSelection,
    setActiveTool,
    handleManualZoomChange,
    handleFitPage,
    navigateToPage,
    effectivePageIndex,
    handleCopy,
    handleCut,
    handlePaste,
    clipboard,
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

  // Informations sur la page active (suit la page focalisée en mode continu).
  const pageInfo = effectivePage
    ? {
        width: effectivePage.dimensions.width,
        height: effectivePage.dimensions.height,
        rotation: effectivePage.dimensions.rotation,
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
            onClick={() => setShowShareDialog(true)}
            disabled={!storedDocumentId}
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

          {/* Document actions menu — keeps the header clean while exposing
              destructive/restorative ops behind an explicit affordance. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label="Actions document"
                disabled={restoring}
              >
                {restoring ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreVertical className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem
                onClick={handleRestoreOriginal}
                disabled={!storedDocumentId || restoring}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span>Restaurer l&apos;original (v1)</span>
                  <span className="text-xs text-muted-foreground">
                    Repart du PDF d&apos;origine, archive les modifications
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleFlattenPdf}
                disabled={!currentPdfFile}
              >
                <Download className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span>Aplatir et télécharger</span>
                  <span className="text-xs text-muted-foreground">
                    Fusionne les calques en une couche unique
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleExportOffice("docx")}
                disabled={!documentId || exportingOfficeFormat !== null}
              >
                {exportingOfficeFormat === "docx" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportWord")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportOffice("xlsx")}
                disabled={!documentId || exportingOfficeFormat !== null}
              >
                {exportingOfficeFormat === "xlsx" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sheet className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportExcel")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportOffice("pptx")}
                disabled={!documentId || exportingOfficeFormat !== null}
              >
                {exportingOfficeFormat === "pptx" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Presentation className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportPowerPoint")}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleExportFormat("png")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "png" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportPng")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("jpeg")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "jpeg" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportJpeg")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("webp")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "webp" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportWebp")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("txt")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "txt" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileType className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportText")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("html")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "html" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileCode className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportHtml")}</span>
              </DropdownMenuItem>
              {/* Universal export (#84): lower the current document into any
                  editable format via the GigaPDF SDK, entirely client-side. */}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("office.exportEditableGroup")}
              </DropdownMenuLabel>
              {SDK_EXPORT_ITEMS.map(({ format, icon: Icon, labelKey }) => (
                <DropdownMenuItem
                  key={format}
                  onClick={() => handleExportModel(format)}
                  disabled={!currentPdfFile || exportingModelFormat !== null}
                >
                  {exportingModelFormat === format ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="mr-2 h-4 w-4" />
                  )}
                  <span>{t(labelKey)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Toolbar */}
      <EditorToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={zoom}
        onZoomChange={handleManualZoomChange}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        hasSelection={selectedElementIds.length > 0}
        onFormatAction={handleFormatAction}
        selectedElement={selectedElements.length === 1 ? selectedElements[0] : null}
        selectedTextElements={selectedTextElements}
        onElementStyleChange={handleTextStyleChange}
        shapeType={shapeType}
        onShapeTypeChange={setShapeType}
        annotationType={annotationType}
        onAnnotationTypeChange={setAnnotationType}
        fieldKind={fieldKind}
        onFieldKindChange={setFieldKind}
        viewMode={viewMode}
        onViewModeChange={(mode) => {
          if (mode === viewMode) return;
          setViewMode(mode);
          if (mode === "continuous") {
            // Focus the page the user was on and bring it into view once the
            // scroller has mounted (next frame).
            activatePage(effectivePageIndex);
            requestAnimationFrame(() =>
              continuousViewRef.current?.scrollToPage(effectivePageIndex, "start"),
            );
          } else {
            // Leaving continuous: single-page view follows the active page.
            goToPage(effectivePageIndex);
          }
        }}
        // Rulers + draggable margins are a continuous-view feature; the toggle
        // only appears there.
        showRulers={showRulers}
        {...(isContinuous ? { onToggleRulers: toggleRulers } : {})}
        rulerUnit={rulerUnit}
        onRulerUnitChange={setRulerUnit}
        fitMode={fitMode}
        onFitPage={handleFitPage}
        onFitWidth={handleFitWidth}
        strokeColor={strokeColor}
        onStrokeColorChange={setStrokeColor}
        fillColor={fillColor}
        onFillColorChange={setFillColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onAddImage={handleAddImage}
        onInsertTable={handleInsertTable}
        onInsertLink={handleInsertLink}
        onRemoveLink={handleRemoveLink}
        onInsertBlankPage={handleInsertBlankPage}
        onInsertList={handleInsertList}
        pageCount={pages.length}
        currentFile={currentPdfFile}
        onToggleFormsPanel={toggleFormsPanel}
        onFlattenPdf={handleFlattenPdf}
        isContentEditActive={isContentEditActive}
        onToggleContentEdit={handleToggleContentEdit}
        onSearchGoToPage={(pageNumber) => {
          // Search returns 1-based page numbers; navigateToPage expects 0-based
          // and scrolls the page into view in continuous mode.
          navigateToPage(pageNumber - 1, "start");
        }}
        onWatermarkApplied={handleWatermarkApplied}
        onCompressApplied={handleCompressApplied}
        onOcrApplied={handleOcrApplied}
        onIndexOcr={handleIndexOcr}
        indexOcrBusy={indexOcrBusy}
        onSignApplied={handleSignApplied}
        headersFootersEnabled={headersFootersEnabled}
        onToggleHeadersFooters={handleToggleHeadersFooters}
        onHeaderFooterApply={handleHeaderFooterApply}
        onHeaderFooterRemove={handleHeaderFooterRemove}
        headerFooterInitialHeader={headerFooterInitialHeader}
        headerFooterInitialFooter={headerFooterInitialFooter}
        headerFooterBusy={headerFooterBusy}
        redactionMarkCount={redactionMarkCount}
        onRedactApply={handleRedactApply}
        onRedactClear={handleRedactClear}
        redactBusy={redactBusy}
      />

      {/* P7 — Édition (#83) : barre secondaire (rechercher/remplacer,
          presse-papiers, format painter). Composant autonome rendu sous la
          barre principale pour garder editor-toolbar.tsx intact. */}
      <EditorEditTools
        onFindReplace={() => setFindReplaceOpen(true)}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onCopyFormat={handleCopyFormat}
        hasSelection={selectedElementIds.length > 0}
        canCopyFormat={canCopyFormat}
        canPaste={canPaste}
        formatPainterArmed={formatPainterArmed}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Pages sidebar */}
        <PagesSidebar
          pages={pages}
          currentPageIndex={effectivePageIndex}
          onPageSelect={(index) => navigateToPage(index, "start")}
          onPageAdd={handleAddPage}
          onPageDelete={handleDeletePage}
          onPageReorder={handleReorderPages}
          onPageDuplicate={handleDuplicatePage}
          previewBaseUrl={process.env.NEXT_PUBLIC_API_URL}
          onPageRotate={handlePageRotate}
          onPageExtract={handlePageExtract}
          thumbnails={thumbnails}
        />

        {/* Canvas — continuous virtualised scroller OR legacy single page.
            Continuous mode owns its own scroll container, so the <main> does
            not scroll there; single mode keeps the historical overflow + the
            mouse-move collaboration cursor tracking. */}
        <main
          ref={canvasRef}
          className={
            isContinuous
              ? "relative flex-1 overflow-hidden"
              : "relative flex-1 overflow-auto"
          }
          onMouseMove={isContinuous ? undefined : handleMouseMove}
        >
          {isContinuous ? (
            <ContinuousPageView
              ref={continuousViewRef}
              pages={pages}
              zoom={zoom}
              pdfFile={currentPdfFile}
              documentId={documentId}
              tool={activeTool}
              activePageIndex={effectivePageIndex}
              onActivatePage={activatePage}
              showRulers={showRulers}
              rulerUnit={rulerUnit}
              onMarginsCommit={handleMarginsCommit}
              getFontFaceName={getFontFaceName}
              onElementAdded={handleElementAdded}
              onElementModified={handleElementModified}
              onElementRemoved={handleElementRemoved}
              onSelectionChanged={handleSelectionChanged}
              onCanvasReady={setCanvasHandle}
            />
          ) : (
            <>
              <EditorCanvas
                page={currentPage}
                documentId={documentId}
                getFontFaceName={getFontFaceName}
                tool={activeTool}
                zoom={zoom}
                fitMode={fitMode}
                onFitZoomChange={setZoom}
                shapeType={shapeType}
                annotationType={annotationType}
                fieldKind={fieldKind}
                strokeColor={strokeColor}
                fillColor={fillColor}
                strokeWidth={strokeWidth}
                onElementAdded={handleElementAdded}
                onElementModified={handleElementModified}
                onElementRemoved={handleElementRemoved}
                onSelectionChanged={handleSelectionChanged}
                onZoomChanged={handleManualZoomChange}
                onCanvasReady={setCanvasHandle}
                onHyperlinkClick={handleHyperlinkClick}
                onRedactionMarksChanged={setRedactionMarkCount}
                overlay={
                  showFormsPanel &&
                  formsMode === "fill" &&
                  loadedFormFields.length > 0 ? (
                    <FormFillOverlay
                      fields={loadedFormFields}
                      currentPageIndex={currentPageIndex}
                      zoom={zoom}
                      focusedFieldName={focusedFormField}
                      onFieldClick={setFocusedFormField}
                    />
                  ) : null
                }
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
            </>
          )}
        </main>

        {/* Properties panel */}
        <PropertiesPanel
          selectedElements={selectedElements}
          onElementUpdate={handleElementUpdate}
          pageInfo={pageInfo}
          zoom={zoom}
          allFieldNames={allFieldNames}
          userLayers={userLayers}
          onAssignElementToLayer={handleAssignElementToLayer}
        />

        {/* Document info sidebar (TOC, Layers, Embedded Files). Layers reflect
            the active page (the focused page in continuous mode). */}
        <DocumentInfoSidebar
          outlines={outlines}
          layers={layers}
          userLayers={userLayers}
          elements={effectivePage?.elements ?? []}
          selectedElementIds={selectedElementIds}
          embeddedFiles={embeddedFiles}
          onNavigateToPage={handleNavigateToPage}
          onElementVisibilityChange={handleElementVisibilityChange}
          onElementLockChange={handleElementLockChange}
          onElementSelect={handleSelectElementFromLayer}
          onLayerCreate={handleLayerCreate}
          onLayerDelete={handleLayerDelete}
          onLayerRename={handleLayerRename}
          onLayerReorder={handleLayerReorder}
          onLayerVisibilityChange={handleLayerVisibilityChange}
          onLayerLockChange={handleLayerLockChange}
          onAssignElementToLayer={handleAssignElementToLayer}
          onDownloadFile={handleDownloadFile}
          currentPageIndex={effectivePageIndex}
        />

        {/* Forms panel (conditionally shown) */}
        {showFormsPanel && (
          <FormsPanel
            currentFile={currentPdfFile}
            mode={formsMode}
            onModeChange={(nextMode) => {
              setFormsMode(nextMode);
              setFocusedFormField(null);
            }}
            onFieldsLoaded={setLoadedFormFields}
            focusedFieldName={focusedFormField}
            designFields={designFields}
            onDesignFieldSelect={handleDesignFieldSelect}
            onDesignFieldReorder={handleDesignFieldReorder}
            onPdfUpdated={(blob) => {
              // Convert blob back to File for subsequent operations
              const file = new File(
                [blob],
                currentPdfFile?.name ?? "document.pdf",
                { type: "application/pdf" }
              );
              updateCurrentPdfFile(file);
              setDirty(true);
              saveWithPriority("immediate");
            }}
          />
        )}
      </div>

      {/* Share dialog (GED) — partage le document STOCKÉ, pas la copie de session */}
      <ShareDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        documentId={storedDocumentId}
        documentName={name}
      />

      {/* P7 — Rechercher & remplacer (texte du scene graph, toutes pages) */}
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        pages={pages}
        onGoToOccurrence={handleFindReplaceGoTo}
        onReplaceOne={handleReplaceOne}
        onReplaceAll={handleReplaceAll}
      />

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
