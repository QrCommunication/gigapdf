"use client";

import React, { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  PageObject,
  Tool,
  Element,
  ShapeType,
  AnnotationType,
  AnnotationElement,
  FieldType,
  FieldCreationKind,
  FormFieldElement,
  Bounds,
} from "@giga-pdf/types";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { clientLogger } from "@/lib/client-logger";

/** Zoom hard bounds (10% – 800%) shared by wheel, toolbar and fit modes. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Multiplicative wheel/keyboard zoom step — fluid, never additive jumps. */
const WHEEL_ZOOM_FACTOR = 1.1;
/** Comfortable breathing room around the page inside the scroll viewport (px). */
const CANVAS_VIEWPORT_PADDING = 32;
/** Snap distance (canvas units) when dragging a form field near another field's edges. */
const FIELD_SNAP_DISTANCE = 4;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// API base URL for image loading
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Resolve image URL - prepend API base URL if it's a relative path
 */
function resolveImageUrl(url: string): string {
  if (!url) return "";
  // If already absolute URL, return as-is
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  // Prepend API base URL for relative paths
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Actions de formatage applicables aux textes sélectionnés depuis la toolbar */
export type TextFormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "alignLeft"
  | "alignCenter"
  | "alignRight";

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
  /** Appliquer un formatage (gras/italique/souligné/alignement) aux textes sélectionnés */
  applyTextFormat: (action: TextFormatAction) => void;
  /**
   * Rendre sur le canvas un élément créé par un collaborateur distant.
   * Aucun événement onElementAdded n'est émis (pas de queueAdd, pas de save,
   * pas de réémission socket). L'appelant garantit que l'élément appartient
   * à la page actuellement affichée.
   */
  applyRemoteElementCreate: (element: Element) => void;
  /**
   * Appliquer la mise à jour distante d'un élément (retire/re-crée l'objet
   * Fabric via le même convertisseur que le render initial). Ignorée si
   * l'élément est sélectionné ou en cours d'édition locale (le local gagne).
   */
  applyRemoteElementUpdate: (element: Element) => void;
  /**
   * Appliquer une mise à jour LOCALE (panneau propriétés) d'un élément :
   * même retire/re-crée via le convertisseur que applyRemoteElementUpdate,
   * mais SANS la garde anti-conflit de sélection — les éléments édités via
   * le panel SONT sélectionnés par construction — et en RESTAURANT la
   * sélection (setActiveObject / ActiveSelection) après la re-création.
   * Aucun onElementModified n'est réémis (beginProgrammaticApply) et les
   * événements de sélection transitoires (discard → re-select) ne sont pas
   * forwardés à page.tsx (la sélection nette est inchangée).
   */
  applyLocalElementUpdate: (element: Element) => void;
  /**
   * Retirer du canvas un élément supprimé par un collaborateur distant.
   * No-op si l'élément n'est pas rendu sur la page affichée.
   */
  applyRemoteElementDelete: (elementId: string) => void;
  /**
   * Afficher/masquer un élément (toggle œil du panneau calques).
   * Le masquage est un OUTIL D'ÉDITION : l'objet Fabric passe visible=false
   * mais l'élément RESTE dans le scene graph et dans le PDF baké au save —
   * aucune redaction n'est déclenchée. Limite connue : les éléments PARSÉS
   * rendus en mode "1:1 fidelity" (overlay transparent au-dessus du raster
   * PDF) gardent leur raster visible — seul l'overlay interactif est masqué.
   * La synchronisation du scene graph est faite par l'appelant (page.tsx).
   */
  setElementVisibility: (elementId: string, visible: boolean) => void;
  /**
   * Verrouiller/déverrouiller un élément (toggle cadenas du panneau calques).
   * Verrouillé = non sélectionnable et non réactif aux événements souris
   * (selectable=false, evented=false) ; l'objet est désélectionné s'il
   * faisait partie de la sélection active. La synchronisation du scene
   * graph est faite par l'appelant (page.tsx).
   */
  setElementLocked: (elementId: string, locked: boolean) => void;
}

export interface EditorCanvasProps {
  /** Page actuelle à afficher */
  page: PageObject | null;
  /** ID du document (session backend) — utilisé pour rendre le fond PDF */
  documentId?: string | null;
  /** Outil actif */
  tool: Tool;
  /** Niveau de zoom (1 = 100%) */
  zoom: number;
  /** Largeur du canvas */
  width?: number;
  /** Hauteur du canvas */
  height?: number;
  /**
   * Resolver for embedded PDF font names: maps the original font ID (e.g. "g_d0_f1")
   * to a CSS font-family registered via FontFace API. When the embedded font is loaded,
   * text is rendered with the SAME font as the PDF background. Returns null for unknown.
   */
  getFontFaceName?: (originalName: string) => string | null;
  /** Type de forme sélectionné */
  shapeType?: ShapeType;
  /** Type d'annotation sélectionné */
  annotationType?: AnnotationType;
  /** Type de champ de formulaire sélectionné (text/checkbox/radio/dropdown) */
  fieldType?: FieldType;
  /**
   * Variante de création du champ de formulaire (palette toolbar) : raffine
   * fieldType avec multiline / date / radio_group. Prioritaire sur fieldType
   * pour la création au clic.
   */
  fieldKind?: FieldCreationKind;
  /**
   * Mode de zoom adaptatif. Quand non-null, le composant recalcule le zoom
   * au resize du viewport (ResizeObserver) et au changement de page, et le
   * remonte via onFitZoomChange. Les interactions manuelles (wheel) passent
   * par onZoomChanged — c'est au parent de remettre fitMode à null.
   */
  fitMode?: "page" | "width" | null;
  /** Zoom recalculé par un mode fit (page/width). */
  onFitZoomChange?: (zoom: number) => void;
  /**
   * Contenu superposé au canvas (ex: surlignage des champs de formulaire en
   * mode Remplir). Rendu DANS le conteneur du canvas, donc positionné en
   * coordonnées page×zoom et défilant avec la page.
   */
  overlay?: React.ReactNode;
  /** Couleur de contour */
  strokeColor?: string;
  /** Couleur de remplissage */
  fillColor?: string;
  /** Épaisseur du contour */
  strokeWidth?: number;
  /** Callback quand un élément est ajouté */
  onElementAdded?: (element: Element) => void;
  /** Callback quand un élément est modifié. oldBounds = bounds AVANT
   *  cette modification (utilisé par apply-elements pour clear la zone
   *  d'origine avant de redessiner — sinon le glyphe original reste). */
  onElementModified?: (element: Element, oldBounds?: Bounds) => void;
  /** Callback quand un élément est supprimé */
  onElementRemoved?: (elementId: string) => void;
  /** Callback quand la sélection change */
  onSelectionChanged?: (elementIds: string[]) => void;
  /** Callback pour changement de zoom */
  onZoomChanged?: (zoom: number) => void;
  /** Callback appelé lorsque le canvas est prêt avec les méthodes exposées */
  onCanvasReady?: (handle: EditorCanvasHandle) => void;
  /** Callback pour les clics sur les liens hypertexte */
  onHyperlinkClick?: (linkUrl?: string | null, linkPage?: number | null) => void;
}

// Génère un ID unique
function generateId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/** Tailles par défaut des widgets de formulaire, par variante de création. */
const FIELD_DEFAULT_SIZES: Record<FieldCreationKind, { width: number; height: number }> = {
  text: { width: 200, height: 30 },
  multiline: { width: 200, height: 80 },
  date: { width: 200, height: 30 },
  checkbox: { width: 20, height: 20 },
  radio_group: { width: 18, height: 18 },
  dropdown: { width: 200, height: 30 },
};

interface NewFormFieldParams {
  elementId: string;
  kind: FieldCreationKind;
  x: number;
  y: number;
  /** Nom du champ — défaut généré depuis le type + timestamp. */
  fieldName?: string;
  /** Texte d'aide affiché dans le widget vide (éditeur uniquement). */
  placeholder?: string | null;
  /** Pour radio : valeur d'export de CE widget dans le groupe. */
  exportValue?: string;
  /** Pour radio/dropdown : liste complète des options. */
  options?: string[];
}

/**
 * Construit un FormFieldElement complet pour une création depuis la palette.
 * Source de vérité unique : stocké dans data.formFieldElement de l'objet
 * Fabric, puis re-fusionné avec les bounds réels par fabricObjectToElement.
 */
function createFormFieldElement(params: NewFormFieldParams): FormFieldElement {
  const { kind, elementId, x, y } = params;
  const size = FIELD_DEFAULT_SIZES[kind];
  const fieldType: FieldType =
    kind === "checkbox"
      ? "checkbox"
      : kind === "radio_group"
        ? "radio"
        : kind === "dropdown"
          ? "dropdown"
          : "text";
  const isList = fieldType === "dropdown";
  const isRadio = fieldType === "radio";
  const isCheckbox = fieldType === "checkbox";

  return {
    elementId,
    type: "form_field",
    bounds: { x, y, width: size.width, height: size.height },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    fieldType,
    fieldName: params.fieldName ?? `${kind}_${Date.now()}`,
    // radio : value = valeur d'export du widget ; checkbox : booléen ;
    // dropdown : sélection (vide) ; text : contenu (vide).
    value: isCheckbox ? false : isRadio ? (params.exportValue ?? "") : isList ? [] : "",
    defaultValue: isCheckbox ? false : isList ? [] : "",
    options: isList || isRadio ? (params.options ?? []) : null,
    properties: {
      required: false,
      readOnly: false,
      maxLength: null,
      multiline: kind === "multiline",
      password: false,
      comb: false,
    },
    style: {
      fontFamily: "Arial",
      fontSize: 12,
      textColor: "#000000",
      backgroundColor: "#ffffff",
      borderColor: "#cccccc",
      borderWidth: 1,
      textAlign: "left",
    },
    format:
      kind === "date"
        ? { type: "date", pattern: "dd/mm/yyyy" }
        : { type: "none", pattern: null },
    placeholder: params.placeholder ?? null,
    tooltip: null,
  };
}

// Fabric stocke fontWeight soit en string ("bold"/"normal"/"700"), soit en
// nombre CSS (400/600/700…). Normalise les deux conventions : toute valeur
// numérique ≥ 600 compte comme bold (semi-bold et au-delà).
function isBoldFontWeight(weight: string | number | undefined): boolean {
  if (typeof weight === "number") return weight >= 600;
  if (!weight) return false;
  if (weight === "bold" || weight === "bolder") return true;
  const numeric = Number.parseInt(weight, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

// Famille de police dominante parmi les éléments texte de la page courante,
// pondérée par la longueur du contenu (un paragraphe long pèse plus qu'une
// puce d'un caractère). Les nouveaux textes créés par l'utilisateur héritent
// de cette famille au lieu d'un "Arial" hardcodé, pour rester visuellement
// cohérents avec le document. Fallback "Arial" si la page n'a aucun texte.
function getDocumentDefaultFontFamily(elements: readonly Element[] | undefined): string {
  if (!elements || elements.length === 0) return "Arial";
  const familyWeights = new Map<string, number>();
  for (const element of elements) {
    if (element.type !== "text") continue;
    const family = (element.style.fontFamily || "").trim();
    if (!family) continue;
    const weight = Math.max(1, (element.content || "").length);
    familyWeights.set(family, (familyWeights.get(family) ?? 0) + weight);
  }
  let best: string | null = null;
  let bestWeight = 0;
  for (const [family, weight] of familyWeights) {
    if (weight > bestWeight) {
      best = family;
      bestWeight = weight;
    }
  }
  return best ?? "Arial";
}

// Bake an alpha value into a hex/rgb colour string. Used for shape fill/
// stroke so a shape with mixed-alpha paint (fill 0.5 + stroke 1.0) keeps
// both layers correct. Pass-through transparent / empty strings unchanged.
function colorWithAlpha(color: string, alpha: number): string {
  if (!color || color === "transparent" || color === "none") return "transparent";
  const a = Math.max(0, Math.min(1, alpha ?? 1));
  if (a >= 0.999) return color;
  const hex = color.trim();
  if (hex.startsWith("#")) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1]! + hex[1]!, 16);
      g = parseInt(hex[2]! + hex[2]!, 16);
      b = parseInt(hex[3]! + hex[3]!, 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      return color;
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (hex.startsWith("rgb(")) {
    return hex.replace(/^rgb\(/, "rgba(").replace(/\)$/, `, ${a})`);
  }
  return color;
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
  documentId,
  tool,
  zoom,
  width = 800,
  height = 600,
  getFontFaceName,
  shapeType = "rectangle",
  annotationType = "highlight",
  fieldType = "text",
  fieldKind = "text",
  fitMode = null,
  onFitZoomChange,
  overlay,
  strokeColor = "#000000",
  fillColor = "transparent",
  strokeWidth = 2,
  onElementAdded,
  onElementModified,
  onElementRemoved,
  onSelectionChanged,
  onZoomChanged,
  onCanvasReady,
  onHyperlinkClick,
}: EditorCanvasProps) {
  const t = useTranslations("editor.canvas");
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const previousPageRef = useRef<string | null>(null);
  // Conteneur scrollable (viewport) — référence directe, JAMAIS de
  // traversée DOM upperCanvasEl.parentElement (fragile aux changements de
  // structure JSX, et le wrapper a maintenant un niveau intermédiaire m-auto).
  const scrollWrapperRef = useRef<HTMLDivElement>(null);

  // Ref pour documentId (évite les closures stale dans loadPage)
  const documentIdRef = useRef(documentId);

  // Refs for callbacks to avoid stale closures in Fabric.js event handlers
  const onElementAddedRef = useRef(onElementAdded);
  const onElementModifiedRef = useRef(onElementModified);
  const onElementRemovedRef = useRef(onElementRemoved);
  const onSelectionChangedRef = useRef(onSelectionChanged);
  const onZoomChangedRef = useRef(onZoomChanged);
  const onHyperlinkClickRef = useRef(onHyperlinkClick);

  // Refs for tool options to avoid stale closures
  const toolRef = useRef(tool);
  const shapeTypeRef = useRef(shapeType);
  const annotationTypeRef = useRef(annotationType);
  const fieldTypeRef = useRef(fieldType);
  const fieldKindRef = useRef(fieldKind);
  const strokeColorRef = useRef(strokeColor);
  const fillColorRef = useRef(fillColor);
  const strokeWidthRef = useRef(strokeWidth);
  const zoomRef = useRef(zoom);
  // Dimensions de la page courante (points PDF) — nécessaires au resize du
  // canvas DOM dans les handlers Fabric enregistrés une seule fois.
  const pageDimsRef = useRef<{ width: number; height: number }>({
    width: width,
    height: height,
  });

  // Invite de saisie rapide pour la création d'un GROUPE de boutons radio :
  // le clic avec fieldKind="radio_group" ouvre ce mini-formulaire (nom du
  // groupe + options, une par ligne) au lieu de poser un objet immédiatement.
  const [radioPrompt, setRadioPrompt] = useState<{ x: number; y: number } | null>(null);
  const [radioGroupName, setRadioGroupName] = useState("");
  const [radioOptionsText, setRadioOptionsText] = useState("");
  // Ouvert depuis le handler mouse:down de Fabric (closure d'init) — passe
  // par une ref pour accéder au setState + aux traductions sans stale closure.
  const openRadioPromptRef = useRef<((x: number, y: number) => void) | null>(null);

  // Zoom + pan refs:
  //   zoomFromWheelRef = true  → the [zoom] useEffect must skip its own
  //                              zoomToPoint call because the wheel handler
  //                              already applied it (cursor-centered).
  //   isSpaceDownRef           → tracks the Space key for "hold-to-pan" UX.
  //   isPanningRef + panStart  → tracks an in-progress pan drag.
  const zoomFromWheelRef = useRef(false);
  const isSpaceDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // Police par défaut des nouveaux textes : famille dominante de la page
  // courante. Valeur dérivée memoïsée — aucun état React supplémentaire,
  // donc aucun re-render parasite. Le miroir ref est nécessaire car le
  // handler mouse:down est enregistré UNE seule fois à l'init de Fabric
  // (closure stale sans ref, même pattern que toolRef/strokeColorRef).
  const pageElements = page?.elements;
  const documentDefaultFontFamily = useMemo(
    () => getDocumentDefaultFontFamily(pageElements),
    [pageElements],
  );
  const documentDefaultFontFamilyRef = useRef(documentDefaultFontFamily);

  // Update refs when props change
  useEffect(() => {
    documentIdRef.current = documentId;
    onElementAddedRef.current = onElementAdded;
    onElementModifiedRef.current = onElementModified;
    onElementRemovedRef.current = onElementRemoved;
    onSelectionChangedRef.current = onSelectionChanged;
    onZoomChangedRef.current = onZoomChanged;
    onHyperlinkClickRef.current = onHyperlinkClick;
    toolRef.current = tool;
    shapeTypeRef.current = shapeType;
    annotationTypeRef.current = annotationType;
    fieldTypeRef.current = fieldType;
    fieldKindRef.current = fieldKind;
    strokeColorRef.current = strokeColor;
    fillColorRef.current = fillColor;
    strokeWidthRef.current = strokeWidth;
    zoomRef.current = zoom;
    documentDefaultFontFamilyRef.current = documentDefaultFontFamily;
    if (page?.dimensions) {
      pageDimsRef.current = {
        width: page.dimensions.width,
        height: page.dimensions.height,
      };
    }
    openRadioPromptRef.current = (x: number, y: number) => {
      setRadioGroupName(`groupe_${Date.now().toString(36)}`);
      setRadioOptionsText(
        [1, 2, 3].map((n) => `${t("defaultOption")} ${n}`).join("\n"),
      );
      setRadioPrompt({ x, y });
    };
  });

  // Historique pour undo/redo
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Ref pour historyIndex — évite les closures stale dans saveHistory
  const historyIndexRef = useRef(-1);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);
  const isUpdatingHistoryRef = useRef(false);
  // Compteur de mutations programmatiques en vol (loadPage, undo/redo,
  // application d'événements de collaboration distants). isUpdatingHistoryRef
  // reste actif tant qu'AU MOINS une mutation est en cours : avec un booléen
  // brut, deux opérations asynchrones entrelacées (ex: un create distant dont
  // le chargement d'image chevauche un loadPage) verraient la première
  // réactiver object:added pendant que la seconde ajoute encore ses objets —
  // d'où un onElementAdded parasite → queueAdd + réémission socket (écho).
  const programmaticApplyDepthRef = useRef(0);
  const beginProgrammaticApply = useCallback(() => {
    programmaticApplyDepthRef.current += 1;
    isUpdatingHistoryRef.current = true;
  }, []);
  const endProgrammaticApply = useCallback(() => {
    programmaticApplyDepthRef.current = Math.max(
      0,
      programmaticApplyDepthRef.current - 1,
    );
    if (programmaticApplyDepthRef.current === 0) {
      isUpdatingHistoryRef.current = false;
    }
  }, []);

  // --- Architecture zoom/pan (CHOIX DOCUMENTÉ) -----------------------------
  // viewportTransform Fabric = SCALE PUR [z,0,0,z,0,0] + canvas DOM
  // redimensionné à page×zoom + scroll NATIF du wrapper overflow-auto.
  // L'ancienne approche mélangeait zoomToPoint (translation dans le vpt) et
  // resize DOM : le contenu Fabric se décalait dans sa boîte DOM et le haut
  // de page devenait inaccessible (flex items-center + overflow). Avec un
  // vpt scale-only : scène → pixels canvas = scène × zoom (déterministe),
  // pan = scrollLeft/Top natifs (scrollbars visibles dans les 2 axes), et
  // les conversions pointeur→scène de Fabric (e.scenePoint) restent exactes
  // sous n'importe quel zoom + scroll — la création d'éléments tombe au bon
  // endroit.
  //
  // applyZoomAtClientPoint : applique un zoom en préservant le point
  // (clientX, clientY) — le pixel logique sous le curseur reste sous le
  // curseur. anchor=null → pas de correction de scroll (cas initial).
  const applyZoomAtClientPoint = useCallback(
    (newZoom: number, anchor: { x: number; y: number } | null): number => {
      const canvas = fabricRef.current;
      if (!canvas) return newZoom;
      const clamped = clampZoom(newZoom);
      const oldZoom = canvas.getZoom() || 1;
      const wrapper = scrollWrapperRef.current;
      const upperEl = canvas.upperCanvasEl as HTMLCanvasElement | undefined;

      // Point de scène sous l'ancre AVANT le changement (vpt scale pur :
      // scène = (client - origineCanvas) / zoom).
      let sceneAnchor: { x: number; y: number } | null = null;
      if (anchor && wrapper && upperEl) {
        const rect = upperEl.getBoundingClientRect();
        sceneAnchor = {
          x: (anchor.x - rect.left) / oldZoom,
          y: (anchor.y - rect.top) / oldZoom,
        };
      }

      const pageW = pageDimsRef.current.width;
      const pageH = pageDimsRef.current.height;
      canvas.setViewportTransform([clamped, 0, 0, clamped, 0, 0]);
      canvas.setDimensions({ width: pageW * clamped, height: pageH * clamped });
      // Le conteneur React garde des width/height inline : on les synchronise
      // immédiatement pour que l'étendue scrollable soit correcte AVANT le
      // re-render React (sinon la correction de scroll serait clampée).
      if (containerRef.current) {
        containerRef.current.style.width = `${pageW * clamped}px`;
        containerRef.current.style.height = `${pageH * clamped}px`;
      }
      canvas.requestRenderAll();

      if (anchor && wrapper && upperEl && sceneAnchor) {
        // Re-mesure APRÈS resize (reflow synchrone) : la position du canvas
        // dans le contenu scrollable peut changer (marges auto du centrage).
        const rect = upperEl.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const offsetLeft = rect.left - wrapperRect.left + wrapper.scrollLeft;
        const offsetTop = rect.top - wrapperRect.top + wrapper.scrollTop;
        wrapper.scrollLeft =
          sceneAnchor.x * clamped + offsetLeft - (anchor.x - wrapperRect.left);
        wrapper.scrollTop =
          sceneAnchor.y * clamped + offsetTop - (anchor.y - wrapperRect.top);
      }
      return clamped;
    },
    [],
  );
  // Miroir ref : le handler mouse:wheel est enregistré une seule fois à
  // l'init de Fabric (même pattern que toolRef).
  const applyZoomAtClientPointRef = useRef(applyZoomAtClientPoint);
  useEffect(() => {
    applyZoomAtClientPointRef.current = applyZoomAtClientPoint;
  }, [applyZoomAtClientPoint]);

  // Zoom "fit" : calcule le zoom pour voir toute la page (page) ou toute la
  // largeur (width) dans le viewport, padding confortable déduit.
  const computeFitZoom = useCallback(
    (mode: "page" | "width"): number | null => {
      const wrapper = scrollWrapperRef.current;
      if (!wrapper) return null;
      const pageW = pageDimsRef.current.width;
      const pageH = pageDimsRef.current.height;
      if (pageW <= 0 || pageH <= 0) return null;
      const availW = wrapper.clientWidth - CANVAS_VIEWPORT_PADDING * 2;
      const availH = wrapper.clientHeight - CANVAS_VIEWPORT_PADDING * 2;
      if (availW <= 0 || availH <= 0) return null;
      const zoomForMode =
        mode === "width" ? availW / pageW : Math.min(availW / pageW, availH / pageH);
      return clampZoom(zoomForMode);
    },
    [],
  );

  const onFitZoomChangeRef = useRef(onFitZoomChange);
  useEffect(() => {
    onFitZoomChangeRef.current = onFitZoomChange;
  });

  // Tant que fitMode est actif, recalcul au resize du viewport
  // (ResizeObserver) et au changement de page. Dès que l'utilisateur zoome
  // manuellement, le parent remet fitMode à null et cet effet se désabonne.
  useEffect(() => {
    if (!fitMode) return;
    const wrapper = scrollWrapperRef.current;
    if (!wrapper) return;
    const recompute = () => {
      const fitZoom = computeFitZoom(fitMode);
      if (fitZoom !== null && Math.abs(fitZoom - zoomRef.current) > 0.001) {
        onFitZoomChangeRef.current?.(fitZoom);
      }
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [fitMode, page, computeFitZoom]);

  // Ref pour tracker le contenu original des textes (pour detecter les vraies modifications)
  const originalContentRef = useRef<Map<string, string>>(new Map());
  // Tracks elementIds for which text:editing:exited just fired and forwarded
  // an update. Fabric v6 also fires object:modified right after exitEditing()
  // (because exitEditing() mutates the object's fill/textBackgroundColor),
  // and without this guard the same edit gets queued twice — visible in the
  // baked PDF as two superposed glyphs in different fonts (g_d0_f7 + g_d0_f8
  // captured in v32 of fe6cd5d3-1f7f-42e3-b3c3-3d04a9d07abd).
  const recentlyForwardedTextEditRef = useRef<Map<string, number>>(new Map());
  const TEXT_EDIT_DEDUPE_WINDOW_MS = 250;
  // Map des bounds connus PAR elementId AVANT chaque modification. Sans
  // cette source, queueUpdate envoie les NOUVELLES bounds comme oldBounds
  // → updateText() côté pdf-engine clear la mauvaise zone et l'ancien
  // glyphe parsé du PDF reste visible (texte dupliqué). On capture les
  // bounds initiaux à chaque load + à chaque création/modification, et
  // on les passe au callback onElementModified pour qu'apply-elements
  // ait la bonne zone à effacer.
  const lastKnownBoundsRef = useRef<Map<string, Bounds>>(new Map());

  // Sauvegarder l'état dans l'historique
  // Utilise historyIndexRef pour éviter une closure stale (sinon saveHistory est
  // recréé à chaque changement d'index, ce qui force la recréation de tous ses
  // dépendants et provoque des re-rendus en cascade).
  const saveHistory = useCallback(
    (canvas: FabricCanvas) => {
      const json = JSON.stringify(canvas.toObject(["data"]));
      setHistoryStack((prev) => {
        const newStack = prev.slice(0, historyIndexRef.current + 1);
        return [...newStack, json];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [] // stable — lit historyIndexRef.current au moment de l'appel
  );

  // Confirme la création d'un groupe de boutons radio : pose un widget radio
  // par option (tous partagent le fieldName du groupe → un seul champ PDF à
  // N widgets au bake) + un label texte à droite de chaque bouton (le label
  // est du contenu de page, comme dans les éditeurs PDF pro — le widget
  // AcroForm ne porte pas de libellé). Chaque canvas.add déclenche
  // handleObjectAdded → onElementAdded → queue + scene graph, le flux normal.
  const handleConfirmRadioGroup = useCallback(async () => {
    const prompt = radioPrompt;
    const canvas = fabricRef.current;
    setRadioPrompt(null);
    if (!prompt || !canvas) return;
    const options = radioOptionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (options.length === 0) return;
    // Charset AcroForm sûr pour le nom de champ.
    const safeName =
      radioGroupName.trim().replace(/[^A-Za-z0-9_.\-]/g, "_") ||
      `radio_${Date.now()}`;
    const { Group, Circle, IText } = await import("fabric");
    const SPACING = 30;
    options.forEach((option, index) => {
      const elementId = generateId();
      const widgetY = prompt.y + index * SPACING;
      const element = createFormFieldElement({
        elementId,
        kind: "radio_group",
        x: prompt.x,
        y: widgetY,
        fieldName: safeName,
        exportValue: option,
        options,
      });
      const widget = new Group(
        [
          new Circle({
            left: 0,
            top: 0,
            radius: 9,
            fill: "#ffffff",
            stroke: "#555555",
            strokeWidth: 1.5,
          }),
        ],
        { left: prompt.x, top: widgetY },
      );
      (widget as FabricObjectWithData).data = {
        elementId,
        formFieldType: "radio",
        fieldName: safeName,
        exportValue: option,
        options,
        formFieldElement: element,
      };
      canvas.add(widget);

      const label = new IText(option, {
        left: prompt.x + 26,
        top: widgetY + 1,
        fontSize: 13,
        fontFamily: documentDefaultFontFamilyRef.current,
        fill: "#000000",
      });
      (label as FabricObjectWithData).data = { elementId: generateId() };
      canvas.add(label);
    });
    canvas.renderAll();
    saveHistory(canvas);
  }, [radioPrompt, radioOptionsText, radioGroupName, saveHistory]);

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

      // Check object type using Fabric's `type` property (stable string).
      // We CANNOT use obj.constructor.name here — production bundlers minify
      // class names (IText becomes "t" in Turbopack output), so any check
      // against "IText"/"Rect"/etc. silently fails and fabricObjectToElement
      // returns null. The Fabric `type` getter returns the same string in
      // dev and prod ("i-text", "rect", "image", …) and is the canonical
      // way to discriminate Fabric object types.
      const typeName = (obj as FabricObject & { type?: string }).type ?? "";

      if (typeName === "i-text" || typeName === "text" || typeName === "textbox") {
        const textObj = obj as FabricObjectWithData & {
          text?: string;
          fontSize?: number;
          fontFamily?: string;
          fontWeight?: string | number;
          fontStyle?: string;
          fill?: string;
          textAlign?: string;
          lineHeight?: number;
          charSpacing?: number;
          originY?: string;
        };
        const textObjWithStyles = textObj as typeof textObj & {
          underline?: boolean;
          linethrough?: boolean;
          textBackgroundColor?: string;
        };
        const data = (obj as FabricObjectWithData).data;
        const fontSize = textObj.fontSize || 16;

        // Inverse of the renderer transform: Fabric IText was created with
        //   top = bounds.y + fontSize + descenderOffset, originY = 'bottom'
        // so the PDF baseline = top - descenderOffset = bounds.y + fontSize.
        // To recover the original bounds.y (= top of glyph in browser coords)
        // we therefore subtract (fontSize + descenderOffset) from obj.top.
        // Storing bounds.y as the baseline (the previous behaviour) put the
        // mask 1 fontSize below the glyph — confirmed via mutool show on a
        // baked v32 of the Free invoice — and produced the LICHALICHA2 doublon.
        const isOriginYBottom = textObj.originY === "bottom";
        const descenderOffset = isOriginYBottom ? fontSize * 0.22 : 0;
        const topOfGlyphY = (obj.top || 0) - descenderOffset - fontSize;

        // Preserve the parser-extracted PDF font name so the bake side
        // (apply-elements -> updateText -> font lookup) can re-use the
        // SAME font as the original glyph instead of falling back to a
        // generic Arial. The Fabric fontFamily ("gigapdf-…") is only valid
        // in the browser FontFace registry, never on the server-side
        // pdf-engine, so we must hand back originalFont separately.
        const originalFont = (data?.originalFont as string | null) ?? null;
        const fontFamilyForRoundTrip =
          originalFont || textObj.fontFamily || "Arial";

        return {
          ...baseElement,
          // Top-left corner of the glyph bbox in browser coords. height = fontSize
          // covers approximately ascender+descender — close enough to mask the
          // glyph cleanly without bleeding into the line above/below.
          bounds: {
            x: obj.left || 0,
            y: topOfGlyphY,
            width: (obj.width || 100) * scaleX,
            height: fontSize,
          },
          type: "text" as const,
          content: textObj.text || "",
          style: {
            fontFamily: fontFamilyForRoundTrip,
            fontSize,
            // Numeric CSS weights (600/700) must round-trip as "bold" too —
            // applyTextFormat and parsed PDFs can both produce them.
            fontWeight: isBoldFontWeight(textObj.fontWeight) ? "bold" : "normal",
            fontStyle: textObj.fontStyle === "italic" ? "italic" : "normal",
            color: (textObj.fill as string) || "#000000",
            opacity: obj.opacity ?? 1,
            textAlign: (textObj.textAlign as "left" | "center" | "right" | "justify") || "left",
            lineHeight: textObj.lineHeight || 1.2,
            letterSpacing: textObj.charSpacing || 0,
            writingMode: "horizontal-tb" as const,
            underline: textObjWithStyles.underline || false,
            strikethrough: textObjWithStyles.linethrough || false,
            backgroundColor: textObjWithStyles.textBackgroundColor || null,
            verticalAlign: "baseline" as const,
            originalFont,
          },
          ocrConfidence: null,
          linkUrl: (data?.linkUrl as string) || null,
          linkPage: (data?.linkPage as number) || null,
        };
      }

      if (typeName === "image") {
        const imgObj = obj as FabricObjectWithData & {
          getSrc?: () => string;
          width?: number;
          height?: number;
          scaleX?: number;
          scaleY?: number;
        };
        const rawSrc = imgObj.getSrc?.() ?? "";
        // Sniff the actual mimetype from the data URL prefix so the backend
        // can pick the right embed path (pdf-lib only handles PNG and JPEG;
        // anything else must be flagged here, not silently mislabelled "png"
        // and re-detected by header bytes downstream).
        const mimeMatch = rawSrc.match(/^data:image\/(png|jpe?g|webp|gif|avif);base64,/i);
        const detected = mimeMatch?.[1]?.toLowerCase().replace("jpeg", "jpg");
        const originalFormat: string = detected ?? "png";
        return {
          ...baseElement,
          type: "image" as const,
          source: {
            type: "embedded" as const,
            dataUrl: rawSrc,
            originalFormat,
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

      // Annotations are stored as Fabric Rect/Line/Circle but carry a
      // data.annotationType marker. If we returned them as "shape" they'd
      // be drawn as regular graphics and the /Annot dict would never be
      // created — annotations must come out as AnnotationElement so the
      // backend renderer produces real PDF annotations (highlight,
      // underline, sticky note, freetext…).
      const dataAnnotationType = (obj.data?.annotationType ?? null) as
        | null
        | 'highlight'
        | 'underline'
        | 'strikeout'
        | 'strikethrough'
        | 'squiggly'
        | 'note'
        | 'comment'
        | 'freetext'
        | 'stamp'
        | 'link';
      if (dataAnnotationType) {
        return {
          ...baseElement,
          type: 'annotation' as const,
          annotationType: dataAnnotationType,
          content: (obj.data?.content as string) ?? '',
          style: {
            color: (obj.stroke as string) || (obj.fill as string) || '#ffff00',
            opacity: obj.opacity ?? 1,
          },
          linkDestination: (obj.data?.linkDestination as AnnotationElement['linkDestination']) ?? null,
          popup: null,
          author: (obj.data?.author as string) ?? undefined,
          // quads is omitted — renderer falls back to bounds when undefined
        } as AnnotationElement;
      }

      // Form fields — testés AVANT la branche shapes : un champ re-rendu par
      // renderElementsOverlay est un Rect Fabric, qui matcherait sinon la
      // branche shape et perdrait son identité de champ.
      // Source de vérité : data.formFieldElement (élément complet stocké à
      // la création ET par renderElementsOverlay), re-fusionné avec les
      // bounds/transform réels de l'objet Fabric — déplacement/resize pris
      // en compte SANS perdre les propriétés métier (options, required,
      // multiline, format…).
      const storedFormField = obj.data?.formFieldElement as
        | FormFieldElement
        | undefined;
      if (storedFormField && storedFormField.type === "form_field") {
        return {
          ...storedFormField,
          ...baseElement,
          type: "form_field" as const,
          fieldType: storedFormField.fieldType,
        };
      }

      if (["rect", "circle", "triangle", "ellipse", "line"].includes(typeName)) {
        let shapeTypeResult: ShapeType = "rectangle";
        if (typeName === "circle") shapeTypeResult = "circle";
        if (typeName === "ellipse") shapeTypeResult = "ellipse";
        if (typeName === "line") shapeTypeResult = "line";
        if (typeName === "triangle") shapeTypeResult = "triangle";

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

      // Fallback legacy : Groups créés avant l'introduction de
      // data.formFieldElement (dont la zone de signature du draw tool).
      if (obj.data?.formFieldType) {
        const ft = obj.data.formFieldType as FieldType;
        const isBooleanField = ft === "checkbox";
        const isRadioField = ft === "radio";
        const isListField = ft === "dropdown" || ft === "listbox";
        return {
          ...baseElement,
          type: "form_field" as const,
          fieldType: ft,
          fieldName: (obj.data.fieldName as string) ?? `${ft}_${Date.now()}`,
          value: isBooleanField
            ? false
            : isRadioField
              ? ((obj.data.exportValue as string) ?? "")
              : isListField
                ? []
                : "",
          defaultValue: isBooleanField ? false : isListField ? [] : "",
          options:
            isListField || isRadioField
              ? ((obj.data.options as string[]) ?? (isListField ? [] : null))
              : null,
          properties: {
            required: Boolean(obj.data.required),
            readOnly: false,
            maxLength: null,
            multiline: Boolean(obj.data.multiline),
            password: false,
            comb: false,
          },
          style: {
            fontFamily: "Arial",
            fontSize: 12,
            textColor: "#000000",
            backgroundColor: "#ffffff",
            borderColor: "#cccccc",
            borderWidth: 1,
          },
          format: { type: "none" as const, pattern: null },
          placeholder: (obj.data.placeholder as string) || null,
          tooltip: null,
        };
      }

      return null;
    },
    []
  );

  // Suppression des événements de sélection pendant applyLocalElementUpdate :
  // le retire/re-crée passe par discardActiveObject → selection:cleared puis
  // setActiveObject → selection:created. Forwarder ces transitions ferait
  // flasher le store (sélection vide un tick) → le properties panel se
  // démonterait/remonterait et l'input en cours de frappe perdrait le focus.
  // La sélection NETTE étant identique avant/après, on ne forward rien.
  const suppressSelectionEventsRef = useRef(false);

  // Handlers d'événements - using refs to avoid stale closures
  const handleSelectionChange = useCallback(() => {
    if (suppressSelectionEventsRef.current) return;
    if (!fabricRef.current) return;
    const activeObjects = fabricRef.current.getActiveObjects();
    const ids = activeObjects
      .map((obj) => (obj as FabricObjectWithData).data?.elementId)
      .filter(Boolean) as string[];
    onSelectionChangedRef.current?.(ids);
  }, []);

  // Type de modification pour distinguer position/contenu/style
  type ModificationType = 'position' | 'content' | 'style';

  // Sample the actual paper / band colour beneath a text overlay, so that
  // when the user enters edit mode we can mask the underlying PDF glyph
  // with a SOLID matching the real background (e.g. the red banner under
  // "Somme à payer le 04 Juin 2025"), instead of a hardcoded white block
  // that would cover the design. Reads pixels just OUTSIDE the bbox on
  // all four sides so the glyph itself never contaminates the sample.
  // Returns rgb() string, or null if the canvas is unreadable (cross-
  // origin tainted, scaled to 0, etc.).
  const sampleBackgroundUnder = useCallback((
    obj: FabricObject,
    textRgb?: [number, number, number] | null,
  ): string | null => {
    const o = obj as unknown as {
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      originY?: string;
      canvas?: { lowerCanvasEl?: HTMLCanvasElement; getZoom?: () => number };
    };
    const lower = o.canvas?.lowerCanvasEl;
    if (!lower) return null;
    const ctx = lower.getContext("2d");
    if (!ctx) return null;
    const zoom = o.canvas?.getZoom?.() ?? 1;
    const left = o.left ?? 0;
    const top = o.top ?? 0;
    const width = o.width ?? 0;
    const height = o.height ?? 0;
    // For text we use originY='bottom' (top = baseline). Translate to a
    // top-left bbox so the probes land in the right places.
    const topLeftY = o.originY === "bottom" ? top - height : top;

    // Probe a fan of points spread across:
    //   - the inside of the bbox (between glyphs we mostly hit the background)
    //   - the immediate edge (1-2 px out of the glyph but still inside any
    //     thin coloured band, e.g. the red "Somme à payer" banner)
    //   - the wider edge (4-6 px out, captures larger uniform areas)
    // We then drop pixels that match the text colour (so the glyph itself
    // doesn't contaminate the result) and pick the dominant remaining shade.
    const probes: Array<[number, number]> = [];
    // Inside bbox sweep
    for (let f = 0.1; f <= 0.9; f += 0.1) {
      probes.push([left + width * f, topLeftY + height * 0.5]);
    }
    // Top / bottom edges (just inside, then 2px and 5px outside)
    for (const dy of [-5, -2, 1, height - 1, height + 2, height + 5]) {
      probes.push([left + width * 0.5, topLeftY + dy]);
      probes.push([left + width * 0.25, topLeftY + dy]);
      probes.push([left + width * 0.75, topLeftY + dy]);
    }
    // Left / right edges
    for (const dx of [-5, -2, width + 2, width + 5]) {
      probes.push([left + dx, topLeftY + height * 0.5]);
    }

    const counts = new Map<string, number>();
    for (const [cx, cy] of probes) {
      const px = Math.round(cx * zoom);
      const py = Math.round(cy * zoom);
      if (px < 0 || py < 0 || px >= lower.width || py >= lower.height) continue;
      let pixel: Uint8ClampedArray;
      try {
        pixel = ctx.getImageData(px, py, 1, 1).data;
      } catch {
        return null; // tainted canvas (CORS) — cannot read
      }
      const r = pixel[0]!;
      const g = pixel[1]!;
      const b = pixel[2]!;
      // Skip pixels that match the text colour within ±20 — they are
      // glyph fragments, not background.
      if (textRgb) {
        const dr = Math.abs(r - textRgb[0]);
        const dg = Math.abs(g - textRgb[1]);
        const db = Math.abs(b - textRgb[2]);
        if (dr < 20 && dg < 20 && db < 20) continue;
      }
      // Quantize to 8-step buckets so anti-aliasing fringes vote together.
      // Math.round(255/8)*8 = 256 — clamp back into [0, 255] so the rgb()
      // string we forward to apply-elements stays in pdf-lib's valid range
      // (it rejects red/green/blue > 1.0 with a misleading 500).
      const qr = Math.min(255, Math.round(r / 8) * 8);
      const qg = Math.min(255, Math.round(g / 8) * 8);
      const qb = Math.min(255, Math.round(b / 8) * 8);
      const key = `${qr},${qg},${qb}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    const [winner] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const [r, g, b] = winner.split(",").map((n) => Number(n));
    return `rgb(${r}, ${g}, ${b})`;
  }, []);

  // Parse a CSS colour string like '#ffffff' or 'rgb(255, 0, 0)' into rgb tuple.
  // Returns null for unsupported formats — caller skips text-colour filtering.
  const parseColorToRgb = useCallback(
    (color: string | undefined | null): [number, number, number] | null => {
      if (!color) return null;
      const c = color.trim().toLowerCase();
      if (c.startsWith("#")) {
        const hex = c.slice(1);
        if (hex.length === 3) {
          return [
            parseInt(hex[0]! + hex[0]!, 16),
            parseInt(hex[1]! + hex[1]!, 16),
            parseInt(hex[2]! + hex[2]!, 16),
          ];
        }
        if (hex.length === 6) {
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
          ];
        }
        return null;
      }
      const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
      return null;
    },
    [],
  );

  // Handler appele quand un texte entre en mode edition.
  // 1:1 fidelity mode: text overlay is invisible by default (PDF native text
  // shows through). On edit-enter we must:
  //   - cover the underlying PDF glyph with a solid matching the REAL
  //     background colour (sampled from the rendered PDF bitmap) so the
  //     mask blends in instead of slapping a white box over the design
  //   - restore the real fill colour so the user sees what they're typing
  // On edit-exit we revert both.
  const handleTextEditingEntered = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const typeName = (obj as FabricObject & { type?: string }).type ?? "";

    if (typeName === "i-text" || typeName === "textbox" || typeName === "text") {
      const elementId = obj.data?.elementId;
      const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

      if (elementId) {
        originalContentRef.current.set(elementId, currentText);
      }

      const realFill = (obj.data?.originalFill as string | undefined) || "#000000";
      // Order of preference for the masking colour:
      //   1. the parser-extracted background (style.backgroundColor) if
      //      present — most accurate when the PDF has an explicit text bg
      //   2. the live pixel sample around the glyph (handles red banners,
      //      coloured cards, gradients) — works for the vast majority of
      //      real-world PDFs
      //   3. fall back to white only if the canvas is unreadable
      const parsedBg = obj.data?.originalBgColor;
      const sampledBg = sampleBackgroundUnder(
        obj as FabricObject,
        parseColorToRgb(realFill),
      );
      const realBg =
        (parsedBg && parsedBg !== "" && parsedBg !== "transparent" && parsedBg)
        || sampledBg
        || "#ffffff";
      (obj as FabricObject & { set: (...args: unknown[]) => void }).set({
        fill: realFill,
        textBackgroundColor: realBg,
        borderColor: "rgba(0, 100, 200, 0.6)",
      });
      const canvas = (obj as FabricObject & { canvas?: { requestRenderAll?: () => void } }).canvas;
      canvas?.requestRenderAll?.();
    }
  }, [sampleBackgroundUnder, parseColorToRgb]);

  // Handler appele quand le texte change en temps reel
  const handleTextChanged = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

    clientLogger.debug("[EditorCanvas] Text changed in real-time:", elementId, `"${currentText}"`);
  }, []);

  // Handler appele quand un texte sort du mode edition.
  // 1:1 mode: revert overlay back to invisible IF the user did not change
  // the content. If they DID change it, keep the new text visible (with
  // its solid background) since the PDF native text underneath is now stale.
  //
  // CRITICAL: when the content changed, we MUST also notify the parent
  // (onElementModified) so the new text gets queued for the PDF bake.
  // Fabric does NOT emit `object:modified` after an inline text edit
  // (only `text:editing:exited` + `text:changed`), so without this
  // explicit forward the edit never reaches apply-elements and the
  // modification is silently lost on reload.
  const handleTextEditingExited = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";
    const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;
    const contentChanged = originalText !== undefined && originalText !== currentText;

    const set = (obj as FabricObject & { set: (...args: unknown[]) => void }).set;
    if (contentChanged) {
      // User edited the text. Keep it visible with a SOLID background that
      // matches the real PDF colour beneath (sampled live), so the stale
      // native glyph stays hidden without slapping a white box on coloured
      // banners. Same priority order as edit-enter.
      const parsedBg = obj.data?.originalBgColor;
      const sampledBg = sampleBackgroundUnder(
        obj as FabricObject,
        parseColorToRgb((obj.data?.originalFill as string | undefined) ?? "#000000"),
      );
      const matchingBg =
        (parsedBg && parsedBg !== "" && parsedBg !== "transparent" && parsedBg)
        || sampledBg
        || "#ffffff";
      set.call(obj, {
        fill: obj.data?.originalFill || "#000000",
        textBackgroundColor: matchingBg,
        borderColor: "rgba(0, 100, 200, 0.75)",
      });
    } else {
      // No change — restore the invisible-overlay state for 1:1 fidelity.
      // Border stays visible while the object remains the active target so
      // the user keeps the visual selection feedback (Fabric only paints
      // the border on the active object anyway, so other glyphs are clean).
      set.call(obj, {
        fill: "rgba(0,0,0,0)",
        textBackgroundColor: "",
        borderColor: "rgba(0, 100, 200, 0.75)",
      });
    }
    const canvas = (obj as FabricObject & { canvas?: { requestRenderAll?: () => void } }).canvas;
    canvas?.requestRenderAll?.();

    // Forward the edit to the parent so it can be queued for the PDF bake.
    // Without this, an inline text edit produces no `object:modified` event
    // (Fabric only fires `text:editing:exited`), and the change vanishes on
    // reload. We pass the OLD bounds tracked since the last render so the
    // bake can clear the original glyph zone before painting the new text.
    if (contentChanged && elementId) {
      const updatedElement = fabricObjectToElement(obj);
      if (updatedElement) {
        const oldBounds = lastKnownBoundsRef.current.get(elementId);
        // Refresh tracking with the post-edit bounds so the next edit on
        // the same element clears the right area.
        lastKnownBoundsRef.current.set(elementId, updatedElement.bounds);
        // Mark this elementId so the object:modified that Fabric fires
        // immediately after exitEditing() (because we mutate fill/bg here)
        // does NOT re-queue the same edit a second time.
        recentlyForwardedTextEditRef.current.set(elementId, Date.now());
        onElementModifiedRef.current?.(updatedElement, oldBounds);
      }
    }
  }, [sampleBackgroundUnder, parseColorToRgb, fabricObjectToElement]);

  const handleObjectModified = useCallback(
    (e: { target?: FabricObject }) => {
      if (!e.target) return;
      const obj = e.target as FabricObjectWithData;
      const elementId = obj.data?.elementId;
      // Use Fabric `type` (stable across minification) — see fabricObjectToElement above.
      const typeName = (obj as FabricObject & { type?: string }).type ?? "";

      // Skip the duplicate fired by Fabric immediately after exitEditing()
      // mutates the IText (we set fill/textBackgroundColor in
      // handleTextEditingExited and that triggers another object:modified
      // for the same edit). Without this guard apply-elements bakes the
      // same text twice in two different fontFaces.
      if (elementId && (typeName === "i-text" || typeName === "textbox" || typeName === "text")) {
        const lastEditAt = recentlyForwardedTextEditRef.current.get(elementId);
        if (lastEditAt && Date.now() - lastEditAt < TEXT_EDIT_DEDUPE_WINDOW_MS) {
          recentlyForwardedTextEditRef.current.delete(elementId);
          clientLogger.debug(
            "[EditorCanvas] Skip object:modified (just forwarded via text:editing:exited)",
            elementId,
          );
          return;
        }
      }

      // Detecter le TYPE de modification
      let modificationType: ModificationType = 'position';

      // Verifier si c'est un objet texte et si le contenu a change
      if (typeName === "i-text" || typeName === "textbox" || typeName === "text") {
        const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;
        const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

        if (originalText !== undefined && originalText !== currentText) {
          modificationType = 'content';
          clientLogger.debug(`[EditorCanvas] Text content MODIFIED: "${originalText}" -> "${currentText}"`);
          // Mettre a jour le contenu original pour les prochaines comparaisons
          if (elementId) {
            originalContentRef.current.set(elementId, currentText);
          }
        } else {
          clientLogger.debug("[EditorCanvas] Element position/style changed only (no content change)");
        }
      } else {
        clientLogger.debug("[EditorCanvas] Non-text element modified (position/style)");
      }

      const element = fabricObjectToElement(obj);
      if (element) {
        clientLogger.debug("[EditorCanvas] Object modified:", element.elementId, element.type, "modification:", modificationType);
        // Récupère les bounds connues AVANT cette modification — c'est
        // ces bounds qui doivent être passées à updateText pour clear
        // la zone d'origine. Sans ça : doublon visuel post-bake.
        const oldBounds = lastKnownBoundsRef.current.get(element.elementId);
        // Mettre à jour pour la prochaine modification
        lastKnownBoundsRef.current.set(element.elementId, element.bounds);
        onElementModifiedRef.current?.(element, oldBounds);
      }
      if (fabricRef.current) {
        saveHistory(fabricRef.current);
      }
    },
    [fabricObjectToElement, saveHistory]
  );

  const handleObjectAdded = useCallback(
    (e: { target?: FabricObject }) => {
      if (isUpdatingHistoryRef.current) return;
      if (!e.target) return;
      // Ignorer le fond PDF (image non-éditable ajoutée en arrière-plan)
      if ((e.target as FabricObjectWithData).data?.isPdfBackground) return;
      const element = fabricObjectToElement(e.target as FabricObjectWithData);
      if (element) {
        clientLogger.debug("[EditorCanvas] Object added:", element.elementId, element.type);
        // Mémoriser les bounds initiales (utilisé par handleObjectModified)
        lastKnownBoundsRef.current.set(element.elementId, element.bounds);
        onElementAddedRef.current?.(element);
      }
    },
    [fabricObjectToElement]
  );

  const handleObjectRemoved = useCallback(
    (e: { target?: FabricObject }) => {
      if (isUpdatingHistoryRef.current) return;
      if (!e.target) return;
      const elementId = (e.target as FabricObjectWithData).data?.elementId;
      if (elementId) {
        clientLogger.debug("[EditorCanvas] Object removed:", elementId);
        onElementRemovedRef.current?.(elementId);
      }
    },
    []
  );

  // Update event handlers when they change
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    // Remove old handlers
    canvas.off("selection:created");
    canvas.off("selection:updated");
    canvas.off("selection:cleared");
    canvas.off("object:modified");
    canvas.off("object:added");
    canvas.off("object:removed");
    canvas.off("text:editing:entered");
    canvas.off("text:changed");
    canvas.off("text:editing:exited");

    // Re-attach updated handlers
    canvas.on("selection:created", handleSelectionChange);
    canvas.on("selection:updated", handleSelectionChange);
    canvas.on("selection:cleared", handleSelectionChange);
    canvas.on("object:modified", handleObjectModified as (e: unknown) => void);
    canvas.on("object:added", handleObjectAdded as (e: unknown) => void);
    canvas.on("object:removed", handleObjectRemoved as (e: unknown) => void);
    // Handlers pour detecter les modifications de contenu texte
    canvas.on("text:editing:entered", handleTextEditingEntered as (e: unknown) => void);
    canvas.on("text:changed", handleTextChanged as (e: unknown) => void);
    canvas.on("text:editing:exited", handleTextEditingExited as (e: unknown) => void);
  }, [handleSelectionChange, handleObjectModified, handleObjectAdded, handleObjectRemoved, handleTextEditingEntered, handleTextChanged, handleTextEditingExited]);

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
      // Architecture scale-pur dès l'init : sans ça, un zoom initial ≠ 1
      // (mode fit restauré) rendrait le contenu non-scalé dans un canvas
      // DOM déjà dimensionné à page×zoom.
      canvas.setViewportTransform([
        zoomRef.current, 0, 0, zoomRef.current, 0, 0,
      ]);

      fabricRef.current = canvas;

      // Event handlers
      canvas.on("selection:created", handleSelectionChange);
      canvas.on("selection:updated", handleSelectionChange);
      canvas.on("selection:cleared", handleSelectionChange);
      canvas.on("object:modified", handleObjectModified as (e: unknown) => void);
      canvas.on("object:added", handleObjectAdded as (e: unknown) => void);
      canvas.on("object:removed", handleObjectRemoved as (e: unknown) => void);
      // Handlers pour detecter les modifications de contenu texte
      canvas.on("text:editing:entered", handleTextEditingEntered as (e: unknown) => void);
      canvas.on("text:changed", handleTextChanged as (e: unknown) => void);
      canvas.on("text:editing:exited", handleTextEditingExited as (e: unknown) => void);

      // Mouse down for creating objects - using refs to get current values
      canvas.on("mouse:down", (e) => {
        if (!fabricRef.current || !e.scenePoint) return;
        const currentCanvas = fabricRef.current;

        // Si on clique sur un objet existant, ne rien créer
        if (e.target) return;

        const pointer = e.scenePoint;
        const currentTool = toolRef.current;
        const currentShapeType = shapeTypeRef.current;
        const currentAnnotationType = annotationTypeRef.current;
        const currentStrokeColor = strokeColorRef.current;
        const currentFillColor = fillColorRef.current;
        const currentStrokeWidth = strokeWidthRef.current;

        clientLogger.debug("[EditorCanvas] mouse:down - tool:", currentTool);

        let newObj: FabricObject | null = null;

        try {
          switch (currentTool) {
            case "text": {
              clientLogger.debug("[EditorCanvas] Creating IText with:", { pointer, strokeColor: currentStrokeColor });
              newObj = new IText(t("defaultText") || "Text", {
                left: pointer.x,
                top: pointer.y,
                fontSize: 16,
                // Famille dominante du document (memoïsée) — un nouveau texte
                // doit ressembler au reste de la page, pas à un Arial générique.
                fontFamily: documentDefaultFontFamilyRef.current,
                fill: currentStrokeColor,
              });
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
              clientLogger.debug("[EditorCanvas] IText created successfully:", newObj);
              break;
            }

          case "shape": {
            const shapeOptions = {
              left: pointer.x,
              top: pointer.y,
              fill: currentFillColor,
              stroke: currentStrokeColor,
              strokeWidth: currentStrokeWidth,
            };

            switch (currentShapeType) {
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
            switch (currentAnnotationType) {
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
            // Crée le champ selon la VARIANTE sélectionnée dans la palette
            // (fieldKind) : text / multiligne / date / case à cocher /
            // groupe radio / liste déroulante. Chaque variante a un visuel
            // distinct pour être identifiable au coup d'œil.
            const currentKind = fieldKindRef.current;

            if (currentKind === "radio_group") {
              // Création différée : un mini-formulaire demande le nom du
              // groupe + les options, puis pose N boutons partageant le
              // même fieldName (voir handleConfirmRadioGroup).
              openRadioPromptRef.current?.(pointer.x, pointer.y);
              break;
            }

            const fieldElementId = generateId();
            const placeholderText =
              currentKind === "text"
                ? t("textPlaceholder")
                : currentKind === "multiline"
                  ? t("multilinePlaceholder")
                  : currentKind === "date"
                    ? t("dateHint")
                    : null;
            const fieldElement = createFormFieldElement({
              elementId: fieldElementId,
              kind: currentKind,
              x: pointer.x,
              y: pointer.y,
              placeholder: placeholderText,
              options:
                currentKind === "dropdown"
                  ? [1, 2, 3].map((n) => `${t("defaultOption")} ${n}`)
                  : undefined,
            });

            let formFieldGroup: InstanceType<typeof Group>;
            switch (currentKind) {
              case "checkbox": {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 20,
                      height: 20,
                      fill: "#ffffff",
                      stroke: "#555555",
                      strokeWidth: 1.5,
                      rx: 2,
                      ry: 2,
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "dropdown": {
                formFieldGroup = new Group(
                  [
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
                    new FabricText(t("selectPlaceholder"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                    new FabricText("▾", {
                      left: 175,
                      top: 6,
                      fontSize: 14,
                      fontFamily: "Arial",
                      fill: "#666666",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "multiline": {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 200,
                      height: 80,
                      fill: "#ffffff",
                      stroke: "#cccccc",
                      strokeWidth: 1,
                      rx: 4,
                      ry: 4,
                    }),
                    new FabricText(t("multilinePlaceholder"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                    // Lignes d'écriture simulées — identifie la zone
                    // multiligne au premier regard.
                    new Line([10, 40, 190, 40], { stroke: "#e5e7eb", strokeWidth: 1 }),
                    new Line([10, 58, 190, 58], { stroke: "#e5e7eb", strokeWidth: 1 }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "date": {
                formFieldGroup = new Group(
                  [
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
                    new FabricText(t("dateHint"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                    new FabricText("📅", {
                      left: 176,
                      top: 7,
                      fontSize: 13,
                      fontFamily: "Arial",
                      fill: "#666666",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "text":
              default: {
                formFieldGroup = new Group(
                  [
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
                    new FabricText(t("textPlaceholder"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
            }

            (formFieldGroup as FabricObjectWithData).data = {
              elementId: fieldElementId,
              formFieldType: fieldElement.fieldType,
              fieldName: fieldElement.fieldName,
              required: false,
              placeholder: fieldElement.placeholder ?? "",
              // Source de vérité complète pour le round-trip Fabric→Element
              // (multiline, format date, options, style…).
              formFieldElement: fieldElement,
            };
            newObj = formFieldGroup;
            break;
          }

          case "draw": {
            // Zone de signature — visuel distinct (bordure dashed, label
            // "Signature" au centre) pour que l'utilisateur comprenne tout
            // de suite que ce n'est pas un simple champ texte.
            const signatureGroup = new Group(
              [
                new Rect({
                  left: 0,
                  top: 0,
                  width: 240,
                  height: 60,
                  fill: "rgba(255, 248, 220, 0.6)",
                  stroke: "#8b5a2b",
                  strokeWidth: 1.5,
                  strokeDashArray: [6, 4],
                  rx: 4,
                  ry: 4,
                }),
                new FabricText("✍  Signature", {
                  left: 70,
                  top: 20,
                  fontSize: 16,
                  fontFamily: "Arial",
                  fontStyle: "italic",
                  fill: "#8b5a2b",
                }),
              ],
              {
                left: pointer.x,
                top: pointer.y,
              },
            );
            (signatureGroup as FabricObjectWithData).data = {
              elementId: generateId(),
              formFieldType: "signature",
              fieldName: `signature_${Date.now()}`,
              required: false,
              placeholder: "Signature",
            };
            newObj = signatureGroup;
            break;
          }
          }
        } catch (error) {
          clientLogger.error("[EditorCanvas] Error creating object:", error);
        }

        if (newObj) {
          clientLogger.debug("[EditorCanvas] Adding new object to canvas:", currentTool, (newObj as FabricObjectWithData).data?.elementId);
          currentCanvas.add(newObj);
          currentCanvas.setActiveObject(newObj);
          currentCanvas.renderAll();
          saveHistory(currentCanvas);
          clientLogger.debug("[EditorCanvas] Object added to canvas, total objects:", currentCanvas.getObjects().length);
        } else {
          clientLogger.debug("[EditorCanvas] mouse:down - newObj is null for tool:", currentTool);
        }
      });

      // Molette :
      //   - Ctrl/Cmd + molette → zoom centré sur le curseur (le point sous
      //     la souris reste sous la souris — applyZoomAtClientPoint ajuste
      //     le scroll après le resize DOM).
      //   - Shift + molette → scroll horizontal (les navigateurs ne
      //     convertissent pas tous deltaY→horizontal sur un canvas).
      //   - Molette seule → scroll vertical NATIF du wrapper (on ne
      //     preventDefault pas : l'événement bulle jusqu'au overflow-auto).
      canvas.on("mouse:wheel", (opt) => {
        const event = opt.e as WheelEvent;

        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          const currentZoom = canvas.getZoom();
          const factor =
            event.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR;
          const newZoom = clampZoom(currentZoom * factor);
          if (newZoom === currentZoom) return;
          applyZoomAtClientPointRef.current(newZoom, {
            x: event.clientX,
            y: event.clientY,
          });
          // Le useEffect [zoom] ne doit pas ré-appliquer (déjà fait ici) ;
          // le parent remet aussi fitMode à null (zoom manuel).
          zoomFromWheelRef.current = true;
          onZoomChangedRef.current?.(newZoom);
          return;
        }

        if (event.shiftKey) {
          const wrapper = scrollWrapperRef.current;
          if (wrapper && event.deltaY !== 0 && event.deltaX === 0) {
            event.preventDefault();
            wrapper.scrollLeft += event.deltaY;
          }
          return;
        }
        // Pas de preventDefault : scroll vertical natif.
      });

      // Pan handlers — activated by:
      //   - the "hand" tool from the toolbar (toolRef.current === 'hand')
      //   - holding Space (any tool)
      //   - middle-click drag (any tool)
      // Drives the wrapper scroll directly so the existing overflow:auto
      // behaviour stays consistent (scrollbars visible, keyboard arrows still
      // work for fine adjustment).
      canvas.on("mouse:down", (opt) => {
        const e = opt.e as MouseEvent;
        const shouldPan =
          e.button === 1 || // middle-click
          isSpaceDownRef.current ||
          toolRef.current === "hand";
        if (!shouldPan) return;
        const wrapper = scrollWrapperRef.current;
        isPanningRef.current = true;
        panStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          scrollLeft: wrapper?.scrollLeft ?? 0,
          scrollTop: wrapper?.scrollTop ?? 0,
        };
        canvas.defaultCursor = "grabbing";
        canvas.selection = false;
        e.preventDefault();
      });

      canvas.on("mouse:move", (opt) => {
        if (!isPanningRef.current || !panStartRef.current) return;
        const e = opt.e as MouseEvent;
        const wrapper = scrollWrapperRef.current;
        if (!wrapper) return;
        wrapper.scrollLeft =
          panStartRef.current.scrollLeft - (e.clientX - panStartRef.current.clientX);
        wrapper.scrollTop =
          panStartRef.current.scrollTop - (e.clientY - panStartRef.current.clientY);
      });

      // Snap léger (4 px) des champs de formulaire sur les bords des autres
      // champs pendant le drag — alignement rapide sans système de guides.
      canvas.on("object:moving", (opt) => {
        const target = opt.target as FabricObjectWithData | undefined;
        if (!target?.data) return;
        const isFormField = (d: FabricObjectWithData["data"]): boolean =>
          Boolean(d && (d.formFieldElement || d.formFieldType || d.type === "form_field"));
        if (!isFormField(target.data)) return;
        const others = canvas.getObjects().filter((o) => {
          if (o === target) return false;
          return isFormField((o as FabricObjectWithData).data);
        });
        // Garde perf : au-delà de 200 champs le snap n'apporte plus rien.
        if (others.length === 0 || others.length > 200) return;
        const targetW = (target.width ?? 0) * (target.scaleX ?? 1);
        const targetH = (target.height ?? 0) * (target.scaleY ?? 1);
        const left = target.left ?? 0;
        const top = target.top ?? 0;
        let bestDx: number | null = null;
        let bestDy: number | null = null;
        for (const other of others) {
          const ol = other.left ?? 0;
          const ot = other.top ?? 0;
          const ow = (other.width ?? 0) * (other.scaleX ?? 1);
          const oh = (other.height ?? 0) * (other.scaleY ?? 1);
          for (const edge of [ol, ol + ow]) {
            for (const myEdge of [left, left + targetW]) {
              const delta = edge - myEdge;
              if (
                Math.abs(delta) <= FIELD_SNAP_DISTANCE &&
                (bestDx === null || Math.abs(delta) < Math.abs(bestDx))
              ) {
                bestDx = delta;
              }
            }
          }
          for (const edge of [ot, ot + oh]) {
            for (const myEdge of [top, top + targetH]) {
              const delta = edge - myEdge;
              if (
                Math.abs(delta) <= FIELD_SNAP_DISTANCE &&
                (bestDy === null || Math.abs(delta) < Math.abs(bestDy))
              ) {
                bestDy = delta;
              }
            }
          }
        }
        if (bestDx !== null) target.set({ left: left + bestDx });
        if (bestDy !== null) target.set({ top: top + bestDy });
      });

      const endPan = () => {
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        panStartRef.current = null;
        const tool = toolRef.current;
        canvas.defaultCursor =
          isSpaceDownRef.current || tool === "hand"
            ? "grab"
            : tool === "select"
              ? "default"
              : "crosshair";
        canvas.selection = tool === "select";
      };
      canvas.on("mouse:up", endPan);
      canvas.on("mouse:out", endPan);

      // Double-click for hyperlinks - using refs
      canvas.on("mouse:dblclick", (e) => {
        if (!e.target) return;
        const obj = e.target as FabricObjectWithData;
        const data = obj.data;
        if (data?.linkUrl || data?.linkPage) {
          onHyperlinkClickRef.current?.(data.linkUrl as string | null, data.linkPage as number | null);
        }
      });

      // Charger la page initiale via loadPage (inclut fond PDF).
      // On doit le faire ici car le useEffect [page, loadPage] vérifie
      // fabricRef.current synchroniquement AVANT que l'import("fabric") se
      // résout → il est déjà sorti sans rien faire.
      if (page) {
        previousPageRef.current = page.pageId;
        loadPage(page, fabricModule).then(() => {
          saveHistory(canvas);
        }).catch(() => {
          saveHistory(canvas);
        });
      } else {
        // Sauvegarder l'état initial du canvas vide
        saveHistory(canvas);
      }
    });

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Renders real PDF elements (text/image/shape/annotation/form_field) from the scene graph
   * onto the Fabric canvas, layered above the PDF background image.
   *
   * Performance note: images are loaded in parallel via Promise.all to stay within 500ms
   * for typical 100-element pages. The canvas is rendered once after all sync objects are
   * added; async image loads each trigger a targeted renderAll on completion.
   */
  // useCallback (et non simple const) : référencé par le useEffect qui expose
  // EditorCanvasHandle — sans identité stable, le handle serait reconstruit à
  // chaque render. Seule dépendance réelle : getFontFaceName (fonts embarquées).
  const renderElementsOverlay = useCallback(async (
    canvas: FabricCanvas,
    elements: Element[],
    fabricModule: typeof import("fabric")
  ): Promise<void> => {
    const { Rect, Circle, Ellipse, Triangle, Line, IText, FabricImage, Path: FabricPath, Polygon } = fabricModule;

    // Collect image-load promises to await them all before the final renderAll
    const imageLoadPromises: Promise<void>[] = [];

    // 1. SORT BY Z-ORDER LAYER: shapes (background fills, banner rectangles)
    //    must render BEHIND text and images. Without this, a red banner shape
    //    extracted later in the parser ends up on top of its own text label,
    //    making it unreadable. Layer order: shape < image < text < annotation < form_field.
    const layerRank: Record<string, number> = {
      shape: 0,
      image: 1,
      draw: 2,
      text: 3,
      annotation: 4,
      form_field: 5,
    };
    const sortedElements = [...elements].sort((a, b) => {
      const ra = layerRank[a.type] ?? 99;
      const rb = layerRank[b.type] ?? 99;
      return ra - rb;
    });

    // 2. DEDUPLICATE near-identical text runs. PDFs sometimes render the
    //    same string twice — generators do this for shadow/relief effects,
    //    or because they layer a vector outline (custom font) above an
    //    invisible selectable-text trace (system font fallback). Both
    //    cases produce two stacked IText objects in our scene graph; the
    //    user sees a doubled title and clicking one selects the wrong
    //    layer.
    //
    //    The signature deliberately ignores fontFamily because the duplicate
    //    typically uses a different family (embedded outline vs Helvetica
    //    fallback). Matching on content + rounded fontSize + tight position
    //    (≤2px) is enough — wider tolerance kills legitimate repeats like
    //    "RONY LICHA" appearing twice on a billing page (sender + recipient).
    //    A real shadow/outline duplicate sits within sub-pixel of its twin;
    //    if x or y differs by >2 px the layout intentionally placed two
    //    runs and we must keep both.
    // Two-tier dedupe heuristic:
    //   1. Same content + same colour + within 2px both axes  → shadow/outline
    //      (drop the second occurrence)
    //   2. Same content + same colour + same X (≤3px) + ANY Y → save-loop
    //      duplicate (form re-renders that bake the overlay back into the
    //      PDF and re-parse it). Drop the second occurrence too.
    //   Otherwise (same content, different X) it is a legitimate cross-line
    //   repeat such as "RONY LICHA" appearing on two address lines, both
    //   on the same y but offset horizontally — keep both.
    //
    //   Colour is part of the signature so a white "6,99€" on a red banner
    //   does not get killed by a black drop-shadow twin that appeared first
    //   in the parser stream.
    const seenTextSignatures = new Map<string, Array<{ x: number; y: number }>>();
    const dedupedElements = sortedElements.filter((el) => {
      if (el.type !== "text") return true;
      const textElement = el as Extract<Element, { type: "text" }>;
      const colourKey = (textElement.style.color || "#000000").toLowerCase();
      const sig = `${textElement.content}|${Math.round(textElement.style.fontSize)}|${colourKey}`;
      const positions = seenTextSignatures.get(sig);
      const here = { x: textElement.bounds.x, y: textElement.bounds.y };
      if (!positions) {
        seenTextSignatures.set(sig, [here]);
        return true;
      }
      const isDuplicate = positions.some((p) => {
        const dx = Math.abs(p.x - here.x);
        const dy = Math.abs(p.y - here.y);
        const shadowOverlap = dx <= 2 && dy <= 2;
        const verticalStack = dx <= 3; // same column, ANY Y → save-loop dupe
        return shadowOverlap || verticalStack;
      });
      if (isDuplicate) return false;
      positions.push(here);
      return true;
    });

    for (const element of dedupedElements) {
      // Guard: skip elements with missing or zero-size bounds
      if (!element.bounds || element.bounds.width <= 0 || element.bounds.height <= 0) {
        continue;
      }

      const baseOptions = {
        left: element.bounds.x,
        top: element.bounds.y,
        // Fabric 6.x defaults to originX/Y: 'center' which treats left/top as
        // the OBJECT CENTER. Parser produces top-left coords, so force origin
        // to 'left'/'top' to avoid visual offset of width/2, height/2.
        originX: "left" as const,
        originY: "top" as const,
        angle: element.transform?.rotation || 0,
        selectable: !element.locked,
        evented: !element.locked,
        visible: element.visible,
      };

      let fabricObj: FabricObject | null = null;

      switch (element.type) {
        case "text": {
          const textElement = element;
          // Resolved colour (kept on .data so edit mode can restore it)
          const textColour = textElement.style.color || "#000000";
          // pdf-engine text-extractor stores bounds.{x,y} at the TOP-LEFT
          // of the glyph bbox (= baseline - fontSize approximated as ascender).
          // For Fabric's baseline to land on the PDF baseline (= bounds.y +
          // fontSize), use originY='bottom' with top = bounds.y + fontSize +
          // descender. Without the descender (~22% of fontSize), Fabric
          // would put its bbox bottom (= baseline + descender) at the PDF
          // baseline, overshooting by descender — visible as a "léger
          // décalage vers le bas" of the editable overlay.
          const _fontSize = textElement.style.fontSize ?? 12;
          const _descenderOffset = _fontSize * 0.22;
          const _baselineY = textElement.bounds.y + _fontSize;
          const textObj = new IText(textElement.content || "", {
            ...baseOptions,
            top: _baselineY + _descenderOffset,
            originY: "bottom" as const,
            width: textElement.bounds.width,
            fontSize: _fontSize,
            fontFamily: (() => {
              const orig = textElement.style.originalFont;
              if (orig && getFontFaceName) {
                const registered = getFontFaceName(orig);
                if (registered) return registered;
              }
              return textElement.style.fontFamily || "Helvetica";
            })(),
            fontWeight: textElement.style.fontWeight || "normal",
            fontStyle: textElement.style.fontStyle || "normal",
            // 1:1 fidelity mode: text is INVISIBLE in view (PDF native text shows
            // through), but kept selectable as a click hit-target for editing.
            // We stash the real colour in data.originalFill so on edit-enter we
            // can show the editor cursor + a faint highlight, and on edit-exit
            // restore back to invisible.
            fill: "rgba(0,0,0,0)",
            opacity: 1,
            textAlign: textElement.style.textAlign || "left",
            lineHeight: textElement.style.lineHeight || 1.2,
            charSpacing: (textElement.style.letterSpacing || 0) * 10,
            underline: textElement.style.underline || false,
            linethrough: textElement.style.strikethrough || false,
            textBackgroundColor: "",
            cursorColor: textColour,
            cursorWidth: 1,
            // Selection visuals stay subtle so we don't pollute the page
            selectionColor: "rgba(0, 100, 200, 0.18)",
            // Selected state must be visually obvious — without a visible
            // border + controls the user clicks the title and sees nothing
            // change, then concludes "the editor is broken". Fabric only
            // draws border/controls when the object is the active target,
            // so this stays clean for the unselected glyphs.
            hasControls: true,
            hasBorders: true,
            borderColor: "rgba(0, 100, 200, 0.75)",
            borderScaleFactor: 1,
            cornerColor: "rgb(0, 100, 200)",
            cornerStrokeColor: "#ffffff",
            cornerSize: 8,
            transparentCorners: false,
          });
          (textObj as FabricObjectWithData).data = {
            elementId: textElement.elementId,
            type: "text",
            originalFont: textElement.style.originalFont,
            originalFill: textColour,
            originalBgColor: textElement.style.backgroundColor || "",
            linkUrl: textElement.linkUrl,
            linkPage: textElement.linkPage,
          };
          // Style hyperlinks
          if ((textElement.linkUrl || textElement.linkPage) && !textElement.style.underline) {
            textObj.set({ underline: true });
          }
          fabricObj = textObj;
          break;
        }

        case "image": {
          const imgElement = element;
          if (imgElement.source?.dataUrl) {
            const imageUrl = resolveImageUrl(imgElement.source.dataUrl);
            const originalWidth = imgElement.source.originalDimensions?.width || imgElement.bounds.width;
            const originalHeight = imgElement.source.originalDimensions?.height || imgElement.bounds.height;
            const targetScaleX = imgElement.bounds.width / (originalWidth || 1);
            const targetScaleY = imgElement.bounds.height / (originalHeight || 1);

            const loadPromise = FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" })
              .then((img: FabricObject) => {
                img.set({
                  ...baseOptions,
                  scaleX: targetScaleX,
                  scaleY: targetScaleY,
                  opacity: imgElement.style?.opacity ?? 1,
                });
                (img as FabricObjectWithData).data = {
                  elementId: imgElement.elementId,
                  type: "image",
                };
                canvas.add(img);
              })
              .catch((err) => {
                clientLogger.error("[EditorCanvas] Failed to load image element:", imgElement.elementId, err);
              });
            imageLoadPromises.push(loadPromise);
          }
          break;
        }

        case "shape": {
          const shapeElement = element;
          const hasStroke = shapeElement.style.strokeColor && shapeElement.style.strokeWidth > 0;
          const hasFill = !!shapeElement.style.fillColor;
          // 1:1 fidelity mode: shapes from the source PDF are visible via the
          // pdfjs-rendered background image. The Fabric overlay only needs to
          // exist as a click hit-target. Stash original styling on .data so
          // the properties panel + edit mode can restore them.
          const fillCss = hasFill
            ? colorWithAlpha(shapeElement.style.fillColor as string, shapeElement.style.fillOpacity ?? 1)
            : "transparent";
          const strokeCss = hasStroke
            ? colorWithAlpha(shapeElement.style.strokeColor as string, shapeElement.style.strokeOpacity ?? 1)
            : "transparent";
          const shapeOptions = {
            ...baseOptions,
            // Transparent in view; data.* keeps the real values for editing.
            fill: "transparent",
            stroke: "transparent",
            strokeWidth: 0,
            opacity: 1,
            // Make the selected state obvious — same rationale as text overlays.
            hasControls: true,
            hasBorders: true,
            borderColor: "rgba(0, 100, 200, 0.75)",
            cornerColor: "rgb(0, 100, 200)",
            cornerStrokeColor: "#ffffff",
            cornerSize: 8,
            transparentCorners: false,
          };
          // Eslint-keep references — used when entering edit mode
          void fillCss; void strokeCss;
          const w = shapeElement.bounds.width;
          const h = shapeElement.bounds.height;

          switch (shapeElement.shapeType) {
            case "rectangle":
              fabricObj = new Rect({
                ...shapeOptions,
                width: w,
                height: h,
                rx: shapeElement.geometry?.cornerRadius || 0,
                ry: shapeElement.geometry?.cornerRadius || 0,
              });
              break;
            case "circle":
              fabricObj = new Circle({ ...shapeOptions, radius: w / 2 });
              break;
            case "ellipse":
              fabricObj = new Ellipse({ ...shapeOptions, rx: w / 2, ry: h / 2 });
              break;
            case "line":
            case "arrow":
              fabricObj = new Line([0, 0, w, 0], shapeOptions);
              break;
            case "triangle":
              fabricObj = new Triangle({ ...shapeOptions, width: w, height: h });
              break;
            case "polygon": {
              // fabric.Polygon needs an explicit points array. We have it on
              // geometry.points (already in canvas coords).
              const pts = shapeElement.geometry?.points ?? [];
              if (pts.length >= 3) {
                fabricObj = new Polygon(pts, shapeOptions);
              } else {
                fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
              }
              break;
            }
            case "path":
            default: {
              // Render via SVG pathData when available — required for any
              // shape with Bezier curves (logos, icons, complex outlines).
              // Falling back to Rect would render a meaningless filled box.
              const pathData = shapeElement.geometry?.pathData;
              if (pathData) {
                // Fabric.Path positions itself at the path's own bounding box
                // top-left, then offsets via left/top. Pass the bounds origin
                // explicitly so the path keeps its absolute canvas position.
                fabricObj = new FabricPath(pathData, {
                  ...shapeOptions,
                  // Override bounds.{x,y} from baseOptions to use the path's
                  // intrinsic bbox; otherwise the path is double-translated.
                  left: shapeElement.bounds.x,
                  top: shapeElement.bounds.y,
                  originX: "left",
                  originY: "top",
                  // fabric.Path computes its own width/height from the path —
                  // do not override.
                });
              } else {
                fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
              }
            }
          }
          if (fabricObj) {
            (fabricObj as FabricObjectWithData).data = {
              elementId: shapeElement.elementId,
              type: "shape",
              originalFill: hasFill ? fillCss : null,
              originalStroke: hasStroke ? strokeCss : null,
              originalStrokeWidth: hasStroke ? shapeElement.style.strokeWidth : 0,
            };
          }
          break;
        }

        case "annotation": {
          const annoElement = element;
          const annoOptions = {
            ...baseOptions,
            opacity: annoElement.style?.opacity ?? 1,
          };
          const annoWidth = annoElement.bounds.width;
          const annoHeight = annoElement.bounds.height;
          const annoColor = annoElement.style?.color || "#ff0000";

          switch (annoElement.annotationType) {
            case "highlight":
              fabricObj = new Rect({
                ...annoOptions,
                width: annoWidth,
                height: annoHeight,
                fill: "rgba(255, 255, 0, 0.3)",
                stroke: "transparent",
              });
              break;
            case "underline":
              fabricObj = new Line([0, 0, annoWidth, 0], {
                ...annoOptions,
                stroke: annoColor,
                strokeWidth: 2,
              });
              break;
            case "strikethrough":
            case "strikeout":
              fabricObj = new Line([0, 0, annoWidth, 0], {
                ...annoOptions,
                stroke: annoColor,
                strokeWidth: 1,
              });
              break;
            case "squiggly":
              // Render as a colored underline for now
              fabricObj = new Line([0, 0, annoWidth, 0], {
                ...annoOptions,
                stroke: annoColor,
                strokeWidth: 2,
                strokeDashArray: [2, 2],
              });
              break;
            case "note":
            case "stamp":
              fabricObj = new Rect({
                ...annoOptions,
                width: Math.min(annoWidth, 30),
                height: Math.min(annoHeight, 30),
                fill: "#ffeb3b",
                stroke: "#ffc107",
                strokeWidth: 1,
              });
              break;
            case "comment":
            case "freetext":
              fabricObj = new Circle({
                ...annoOptions,
                radius: Math.min(annoWidth, annoHeight) / 2,
                fill: "#2196f3",
                stroke: "#1976d2",
                strokeWidth: 1,
              });
              break;
            case "link":
              fabricObj = new Rect({
                ...annoOptions,
                width: annoWidth,
                height: annoHeight,
                fill: "rgba(0, 100, 200, 0.1)",
                stroke: "#0066cc",
                strokeWidth: 1,
              });
              break;
            default:
              fabricObj = new Rect({
                ...annoOptions,
                width: annoWidth,
                height: annoHeight,
                fill: "rgba(255, 255, 0, 0.3)",
              });
          }
          if (fabricObj) {
            (fabricObj as FabricObjectWithData).data = {
              elementId: annoElement.elementId,
              type: "annotation",
              annotationType: annoElement.annotationType,
              linkDestination: annoElement.linkDestination,
            };
          }
          break;
        }

        case "form_field": {
          const formElement = element;
          const fieldColorMap: Record<string, string> = {
            text: "rgba(0, 100, 255, 0.08)",
            checkbox: "rgba(0, 180, 0, 0.1)",
            radio: "rgba(0, 180, 0, 0.1)",
            dropdown: "rgba(100, 0, 255, 0.08)",
            listbox: "rgba(100, 0, 255, 0.08)",
            signature: "rgba(255, 100, 0, 0.1)",
            button: "rgba(50, 50, 50, 0.1)",
          };
          const fieldBorderMap: Record<string, string> = {
            text: "#0066cc",
            checkbox: "#00aa00",
            radio: "#00aa00",
            dropdown: "#6600cc",
            listbox: "#6600cc",
            signature: "#ff6600",
            button: "#333333",
          };
          const fieldFill = fieldColorMap[formElement.fieldType] ?? "rgba(0, 100, 255, 0.08)";
          const fieldStroke = fieldBorderMap[formElement.fieldType] ?? "#0066cc";

          fabricObj = new Rect({
            ...baseOptions,
            width: formElement.bounds.width,
            height: formElement.bounds.height,
            fill: fieldFill,
            stroke: fieldStroke,
            strokeDashArray: [4, 4],
            strokeWidth: 1,
          });
          (fabricObj as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            // Élément complet : fabricObjectToElement le re-fusionne avec
            // les bounds réels → aucune propriété métier perdue au move.
            formFieldElement: formElement,
          };
          break;
        }
      }

      if (fabricObj) {
        canvas.add(fabricObj);
      }
    }

    // Wait for all async image loads before final render
    if (imageLoadPromises.length > 0) {
      await Promise.all(imageLoadPromises);
    }

    canvas.renderAll();
  }, [getFontFaceName]);

  // Charger une page dans le canvas
  const loadPage = useCallback(
    async (pageData: PageObject, fabricModule: typeof import("fabric")) => {
      if (!fabricRef.current) return;
      const canvas = fabricRef.current;

      // Bloquer les événements object:added/removed pendant le chargement pour
      // éviter d'envoyer des appels API pour des éléments déjà existants
      beginProgrammaticApply();

      canvas.clear();
      canvas.backgroundColor = "#ffffff";

      // --- Rendu du fond PDF ---
      // On rend la page PDF comme une image Fabric.js non-sélectionnable à
      // l'index 0, de sorte qu'elle soit affectée par canvas.setZoom() comme
      // tous les autres objets (backgroundImage ne l'est pas).
      const docId = documentIdRef.current;
      if (docId) {
        try {
          const pdfUrl = `/backend-api/api/v1/documents/${docId}/download`;
          const { getAuthToken } = await import("@/lib/api");
          const token = await getAuthToken();
          const response = await fetch(pdfUrl, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            // Import dynamique pour éviter les problèmes SSR
            const { PDFRenderer } = await import("@giga-pdf/canvas");
            const renderer = new PDFRenderer();
            await renderer.loadDocument(arrayBuffer);
            // Rendre à une résolution plus élevée (HiDPI) pour un rendu net,
            // puis réduire l'image via scaleX/scaleY pour garder les dimensions PDF correctes.
            const renderScale = Math.min(window.devicePixelRatio || 2, 3);
            const dataUrl = await renderer.renderPageToDataURL(pageData.pageNumber, {
              scale: renderScale,
              // Render PDF natively (text + paths). The Fabric overlay above
              // is rendered TRANSPARENT so it acts as a click hit-target only,
              // preserving 1:1 visual fidelity. Mask only kicks in once the
              // user enters edit mode on a specific text item.
              maskText: false,
            });
            renderer.dispose();

            const bgImg = await fabricModule.FabricImage.fromURL(dataUrl);
            bgImg.set({
              left: 0,
              top: 0,
              // Fabric v6 defaults originX/Y to 'center'. Without forcing
              // 'left'/'top' the image is centred on (0, 0) and only its
              // bottom-right quadrant lands inside the canvas — producing
              // the "PDF appears as fragments" visual bug.
              originX: "left",
              originY: "top",
              scaleX: 1 / renderScale,
              scaleY: 1 / renderScale,
              selectable: false,
              evented: false,
              hasControls: false,
              hasBorders: false,
            });
            (bgImg as FabricObjectWithData).data = { isPdfBackground: true };
            canvas.add(bgImg); // canvas est vide ici → bgImg est à l'index 0
          }
        } catch (e) {
          clientLogger.warn("[EditorCanvas] Could not render PDF background:", e);
        }
      }

      // --- Charger les éléments éditables par-dessus le fond PDF ---
      // renderElementsOverlay handles all element types (text/image/shape/annotation/form_field),
      // attaches rich metadata to each Fabric object's .data property, and awaits async image loads
      // before the final canvas.renderAll() — so the canvas is fully populated in one shot.
      if (pageData.elements && pageData.elements.length > 0) {
        // Capturer les bounds initiaux POUR CHAQUE élément. Sans ça
        // la première modification d'un élément parsé efface la NOUVELLE
        // zone (oldBounds undefined → fallback element.bounds) et le
        // glyphe original reste visible.
        for (const el of pageData.elements) {
          if (el.elementId && el.bounds) {
            lastKnownBoundsRef.current.set(el.elementId, el.bounds);
          }
        }
        await renderElementsOverlay(canvas, pageData.elements, fabricModule);
      } else {
        canvas.renderAll();
      }

      endProgrammaticApply();
    },
    // beginProgrammaticApply/endProgrammaticApply/renderElementsOverlay sont
    // référencés via la closure du premier render (deps [] volontaires,
    // pattern existant) — begin/end sont stables, renderElementsOverlay ne
    // varie qu'avec getFontFaceName.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Mettre à jour le zoom (changement venant du store : toolbar, presets,
  // raccourcis, modes fit).
  //
  // - Changement issu de la molette (zoomFromWheelRef=true) : le handler a
  //   déjà tout appliqué de façon ancrée sur le curseur — on consomme juste
  //   le flag.
  // - Sinon : zoom ancré sur le CENTRE du viewport visible, pour que le
  //   point focal de l'utilisateur ne saute pas au coin (0,0).
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    if (zoomFromWheelRef.current) {
      zoomFromWheelRef.current = false;
      return;
    }
    const wrapper = scrollWrapperRef.current;
    let anchor: { x: number; y: number } | null = null;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    applyZoomAtClientPoint(zoom, anchor);
  }, [zoom, page, applyZoomAtClientPoint]);

  // Mettre à jour les options de l'outil
  useEffect(() => {
    if (!fabricRef.current) return;
    fabricRef.current.selection = tool === "select";
    fabricRef.current.defaultCursor =
      tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
    fabricRef.current.renderAll();
  }, [tool]);

  // Hold-Space-to-pan : track Space key globally so the user can grab the
  // page from any tool without switching. We ignore the keystroke when an
  // editable element is focused (typing inside an IText overlay, a form
  // field, the search bar, etc.) so the user can still type spaces.
  useEffect(() => {
    const isTextInputFocused = (): boolean => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      // Fabric's IText editing creates a hidden textarea — guard against it.
      if (el.classList?.contains("upper-canvas")) return false;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (isTextInputFocused()) return;
      if (isSpaceDownRef.current) return;
      isSpaceDownRef.current = true;
      const canvas = fabricRef.current;
      if (canvas) {
        canvas.defaultCursor = "grab";
        canvas.selection = false;
      }
      e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      isSpaceDownRef.current = false;
      const canvas = fabricRef.current;
      if (!canvas) return;
      const t = toolRef.current;
      canvas.defaultCursor =
        t === "hand" ? "grab" : t === "select" ? "default" : "crosshair";
      canvas.selection = t === "select";
    };

    // Perte de focus fenêtre pendant un Espace maintenu (Alt+Tab, devtools) :
    // sans ce reset le keyup est raté et le curseur reste bloqué en "grab".
    const onWindowBlur = () => {
      if (!isSpaceDownRef.current) return;
      isSpaceDownRef.current = false;
      const canvas = fabricRef.current;
      if (!canvas) return;
      const t = toolRef.current;
      canvas.defaultCursor =
        t === "hand" ? "grab" : t === "select" ? "default" : "crosshair";
      canvas.selection = t === "select";
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

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
              // Fabric v6 defaults originX/Y to 'center'; force 'left'/'top'
              // so left/top reference the corner, not the centre.
              originX: "left",
              originY: "top",
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
        const newIndex = historyIndex - 1;
        const json = historyStack[newIndex];
        if (!json) return;
        beginProgrammaticApply();
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          endProgrammaticApply();
        });
      },
      redo: () => {
        if (historyIndex >= historyStack.length - 1 || !fabricRef.current)
          return;
        const newIndex = historyIndex + 1;
        const json = historyStack[newIndex];
        if (!json) return;
        beginProgrammaticApply();
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          endProgrammaticApply();
        });
      },
      canUndo: () => historyIndex > 0,
      canRedo: () => historyIndex < historyStack.length - 1,
      deleteSelected: () => {
        if (!fabricRef.current) return;
        const activeObjects = fabricRef.current.getActiveObjects();
        // Capture elementIds BEFORE remove() — Fabric drops .data on
        // removed objects in some paths and the object:removed listener
        // can miss them, leaving the scene graph + Redis with stale
        // entries (and the doc never marked dirty).
        const removedIds = activeObjects
          .map((obj) => (obj as FabricObjectWithData).data?.elementId)
          .filter((id): id is string => Boolean(id));
        activeObjects.forEach((obj) => {
          fabricRef.current?.remove(obj);
        });
        fabricRef.current.discardActiveObject();
        fabricRef.current.renderAll();
        saveHistory(fabricRef.current);
        // Defense-in-depth: explicitly forward each elementId to the
        // React side. The Fabric object:removed event also fires, but
        // the parent handler is idempotent (it deselects + queues a
        // delete; running twice is a no-op for already-removed ids).
        for (const id of removedIds) {
          onElementRemovedRef.current?.(id);
        }
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
      applyTextFormat: (action: TextFormatAction) => {
        if (!fabricRef.current) return;
        const canvas = fabricRef.current;
        // getActiveObjects() aplatit une ActiveSelection en ses enfants —
        // sélection simple et multiple sont donc traitées uniformément.
        const textObjects = canvas.getActiveObjects().filter((obj) => {
          const typeName = (obj as FabricObject & { type?: string }).type ?? "";
          return typeName === "i-text" || typeName === "text" || typeName === "textbox";
        }) as Array<
          FabricObjectWithData & {
            fontWeight?: string | number;
            fontStyle?: string;
            underline?: boolean;
          }
        >;
        if (textObjects.length === 0) return;

        for (const obj of textObjects) {
          switch (action) {
            case "bold":
              obj.set({
                fontWeight: isBoldFontWeight(obj.fontWeight) ? "normal" : "bold",
              });
              break;
            case "italic":
              obj.set({
                fontStyle: obj.fontStyle === "italic" ? "normal" : "italic",
              });
              break;
            case "underline":
              obj.set({ underline: !obj.underline });
              break;
            case "alignLeft":
              obj.set({ textAlign: "left" });
              break;
            case "alignCenter":
              obj.set({ textAlign: "center" });
              break;
            case "alignRight":
              obj.set({ textAlign: "right" });
              break;
          }
        }
        canvas.requestRenderAll();

        // MÊME synchronisation scene-graph que handleObjectModified (souris) :
        // conversion objet→element + oldBounds trackés AVANT la modification
        // (zone à effacer côté apply-elements) + onElementModified, puis un
        // snapshot d'historique unique pour toute l'action.
        for (const obj of textObjects) {
          const element = fabricObjectToElement(obj);
          if (!element) continue;
          const oldBounds = lastKnownBoundsRef.current.get(element.elementId);
          // Changement de style pur : le glyphe ne bouge pas. Dans une
          // ActiveSelection, obj.left/top sont RELATIFS à la sélection —
          // des bounds recalculées seraient fausses ; on réutilise alors
          // les bounds trackées.
          const bounds = obj.group && oldBounds ? oldBounds : element.bounds;
          const syncedElement = { ...element, bounds };
          lastKnownBoundsRef.current.set(element.elementId, bounds);
          onElementModifiedRef.current?.(syncedElement, oldBounds);
        }
        saveHistory(canvas);
      },

      // --- Application des événements de collaboration distants ---
      // Ces trois méthodes reproduisent l'effet d'une action utilisateur SANS
      // repasser par les callbacks Fabric : beginProgrammaticApply bloque
      // handleObjectAdded/Removed pendant l'opération, donc AUCUN
      // onElementAdded/onElementRemoved ne remonte à page.tsx → pas de
      // queueAdd/queueUpdate/queueDelete, pas de save, pas de réémission
      // socket (anti-boucle d'écho). Le scene graph React est mis à jour par
      // l'appelant (page.tsx) AVANT l'appel.
      applyRemoteElementCreate: (element: Element) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        void (async () => {
          beginProgrammaticApply();
          try {
            const fabricModule = await import("fabric");
            // Double délivrance réseau : si l'objet existe déjà, le retirer
            // d'abord au lieu d'empiler un doublon visuel.
            const existing = canvas
              .getObjects()
              .find(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId ===
                  element.elementId,
              );
            if (existing) canvas.remove(existing);
            // Même tracking qu'au load : bounds initiales pour que la
            // première modification locale efface la bonne zone au bake.
            lastKnownBoundsRef.current.set(element.elementId, element.bounds);
            if (element.type === "text") {
              originalContentRef.current.set(
                element.elementId,
                element.content || "",
              );
            }
            // Réutilise le MÊME convertisseur element→Fabric que le render
            // initial (z-order, data.elementId, originX/Y 'left'/'top',
            // baseline texte, fonts embarquées).
            await renderElementsOverlay(canvas, [element], fabricModule);
          } catch (err) {
            clientLogger.error(
              "[EditorCanvas] applyRemoteElementCreate failed:",
              element.elementId,
              err,
            );
          } finally {
            endProgrammaticApply();
          }
        })();
      },
      applyRemoteElementUpdate: (element: Element) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const existing = canvas
          .getObjects()
          .find(
            (o) =>
              (o as FabricObjectWithData).data?.elementId === element.elementId,
          ) as (FabricObjectWithData & { isEditing?: boolean }) | undefined;
        // L'édition locale gagne : un élément sélectionné ou en cours
        // d'édition inline n'est PAS écrasé par l'update distant (dernière
        // écriture au save).
        if (existing) {
          const isSelectedLocally = canvas
            .getActiveObjects()
            .some(
              (o) =>
                (o as FabricObjectWithData).data?.elementId ===
                element.elementId,
            );
          if (isSelectedLocally || Boolean(existing.isEditing)) {
            clientLogger.debug(
              "[EditorCanvas] Remote update ignored (element locally selected/editing):",
              element.elementId,
            );
            return;
          }
        }
        void (async () => {
          beginProgrammaticApply();
          try {
            const fabricModule = await import("fabric");
            // Retirer/re-créer via le convertisseur : plus sûr que muter
            // propriété par propriété (offsets baseline/descender, fonts
            // embarquées et mode "1:1 fidelity" recalculés comme au load).
            // La sélection locale d'AUTRES objets n'est pas affectée.
            if (existing) canvas.remove(existing);
            lastKnownBoundsRef.current.set(element.elementId, element.bounds);
            if (element.type === "text") {
              originalContentRef.current.set(
                element.elementId,
                element.content || "",
              );
            }
            await renderElementsOverlay(canvas, [element], fabricModule);
          } catch (err) {
            clientLogger.error(
              "[EditorCanvas] applyRemoteElementUpdate failed:",
              element.elementId,
              err,
            );
          } finally {
            endProgrammaticApply();
          }
        })();
      },
      // Variante LOCALE de applyRemoteElementUpdate pour les éditions du
      // panneau propriétés : même retire/re-crée via le convertisseur, mais
      // SANS la garde "élément sélectionné = ignoré" (les éléments du panel
      // SONT sélectionnés par construction) et en restaurant la sélection
      // après re-création — y compris les multi-sélections (ActiveSelection).
      applyLocalElementUpdate: (element: Element) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        void (async () => {
          beginProgrammaticApply();
          suppressSelectionEventsRef.current = true;
          try {
            const fabricModule = await import("fabric");
            const existing = canvas
              .getObjects()
              .find(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId ===
                  element.elementId,
              ) as
              | (FabricObjectWithData & {
                  isEditing?: boolean;
                  exitEditing?: () => void;
                })
              | undefined;

            // Capture la sélection active AVANT le retire/re-crée pour la
            // restaurer à l'identique (mono ou multi-sélection).
            const activeIds = canvas
              .getActiveObjects()
              .map((o) => (o as FabricObjectWithData).data?.elementId)
              .filter((id): id is string => Boolean(id));
            const wasSelected = activeIds.includes(element.elementId);

            if (existing) {
              // Texte en cours d'édition inline : sortir du mode édition
              // SANS forwarder de modification (le panel est la source de
              // cette mise à jour, pas l'IText).
              if (
                existing.isEditing &&
                typeof existing.exitEditing === "function"
              ) {
                originalContentRef.current.delete(element.elementId);
                existing.exitEditing();
              }
              if (wasSelected) canvas.discardActiveObject();
              canvas.remove(existing);
            }

            lastKnownBoundsRef.current.set(element.elementId, element.bounds);
            if (element.type === "text") {
              originalContentRef.current.set(
                element.elementId,
                element.content || "",
              );
            }
            await renderElementsOverlay(canvas, [element], fabricModule);

            // Restaurer la sélection sur l'objet re-créé (et les éventuels
            // autres membres d'une multi-sélection, intacts sur le canvas).
            if (wasSelected) {
              const toSelect = activeIds
                .map((id) =>
                  canvas
                    .getObjects()
                    .find(
                      (o) =>
                        (o as FabricObjectWithData).data?.elementId === id,
                    ),
                )
                .filter((o): o is FabricObject => Boolean(o));
              if (toSelect.length === 1) {
                canvas.setActiveObject(toSelect[0]!);
              } else if (toSelect.length > 1) {
                canvas.setActiveObject(
                  new fabricModule.ActiveSelection(toSelect, { canvas }),
                );
              }
            }
            canvas.requestRenderAll();
          } catch (err) {
            clientLogger.error(
              "[EditorCanvas] applyLocalElementUpdate failed:",
              element.elementId,
              err,
            );
          } finally {
            suppressSelectionEventsRef.current = false;
            endProgrammaticApply();
          }
        })();
      },
      applyRemoteElementDelete: (elementId: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const target = canvas
          .getObjects()
          .find(
            (o) => (o as FabricObjectWithData).data?.elementId === elementId,
          ) as
          | (FabricObjectWithData & {
              isEditing?: boolean;
              exitEditing?: () => void;
            })
          | undefined;
        if (!target) return; // pas rendu sur la page affichée — rien à retirer
        beginProgrammaticApply();
        try {
          // Si le texte supprimé est en cours d'édition locale : sortir du
          // mode édition SANS forwarder de modification. exitEditing()
          // déclenche handleTextEditingExited, qui ne forward que si
          // originalContentRef contient l'ancienne valeur — on la retire
          // AVANT pour que contentChanged === false.
          if (target.isEditing && typeof target.exitEditing === "function") {
            originalContentRef.current.delete(elementId);
            target.exitEditing();
          }
          // Désélectionner si l'objet fait partie de la sélection active,
          // sinon Fabric garde des contrôles orphelins sur un objet retiré.
          const isSelected = canvas
            .getActiveObjects()
            .some(
              (o) => (o as FabricObjectWithData).data?.elementId === elementId,
            );
          if (isSelected) canvas.discardActiveObject();
          canvas.remove(target);
          // Nettoyage des refs de tracking pour cet élément.
          lastKnownBoundsRef.current.delete(elementId);
          originalContentRef.current.delete(elementId);
          recentlyForwardedTextEditRef.current.delete(elementId);
          canvas.requestRenderAll();
        } finally {
          endProgrammaticApply();
        }
      },

      // --- Visibilité / verrouillage des calques (panneau calques) ---
      // Mutations programmatiques pures, même contrat que les applyRemote* :
      // beginProgrammaticApply bloque les callbacks Fabric pendant
      // l'opération → aucun onElementAdded/Modified parasite ne remonte.
      // L'appelant (page.tsx) met à jour le scene graph et déclenche le
      // save lui-même. Au re-render d'une page (loadPage), les états sont
      // ré-appliqués depuis element.visible/element.locked par
      // renderElementsOverlay (baseOptions) — rien à re-faire ici.
      setElementVisibility: (elementId: string, visible: boolean) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const target = canvas
          .getObjects()
          .find(
            (o) => (o as FabricObjectWithData).data?.elementId === elementId,
          ) as
          | (FabricObjectWithData & {
              isEditing?: boolean;
              exitEditing?: () => void;
            })
          | undefined;
        if (!target) return;
        // Texte en cours d'édition inline : committer l'édition via le flux
        // normal AVANT de masquer (hors garde programmatique, pour que
        // handleTextEditingExited forwarde le changement de contenu).
        if (
          !visible &&
          target.isEditing &&
          typeof target.exitEditing === "function"
        ) {
          target.exitEditing();
        }
        beginProgrammaticApply();
        try {
          if (!visible) {
            // Désélectionner avant de masquer, sinon Fabric garde des
            // contrôles orphelins sur un objet invisible.
            const isSelected = canvas
              .getActiveObjects()
              .some(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId === elementId,
              );
            if (isSelected) canvas.discardActiveObject();
          }
          target.set({ visible });
          canvas.requestRenderAll();
        } finally {
          endProgrammaticApply();
        }
      },
      setElementLocked: (elementId: string, locked: boolean) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const target = canvas
          .getObjects()
          .find(
            (o) => (o as FabricObjectWithData).data?.elementId === elementId,
          ) as
          | (FabricObjectWithData & {
              isEditing?: boolean;
              exitEditing?: () => void;
            })
          | undefined;
        if (!target) return;
        // Committer une édition inline en cours avant de verrouiller
        // (même raison que setElementVisibility).
        if (
          locked &&
          target.isEditing &&
          typeof target.exitEditing === "function"
        ) {
          target.exitEditing();
        }
        beginProgrammaticApply();
        try {
          if (locked) {
            const isSelected = canvas
              .getActiveObjects()
              .some(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId === elementId,
              );
            if (isSelected) canvas.discardActiveObject();
          }
          target.set({
            selectable: !locked,
            evented: !locked,
            hasControls: !locked,
            hasBorders: !locked,
            lockMovementX: locked,
            lockMovementY: locked,
          });
          canvas.requestRenderAll();
        } finally {
          endProgrammaticApply();
        }
      },
    };

    onCanvasReady(handle);
  }, [historyIndex, historyStack, onCanvasReady, fabricObjectToElement, saveHistory, renderElementsOverlay, beginProgrammaticApply, endProgrammaticApply]);

  // Calculer les dimensions du canvas basées sur la page
  const canvasWidth = page?.dimensions?.width || width;
  const canvasHeight = page?.dimensions?.height || height;

  return (
    // Viewport scrollable : le contenu interne prend page×zoom (+ padding),
    // les scrollbars natives apparaissent dans les 2 axes dès que la page
    // déborde. PAS de items-center/justify-center ici : avec un contenu en
    // overflow, le centrage flex rend le haut/gauche de page inatteignable
    // au scroll (c'était le bug « impossible de bouger dans la page »).
    <div
      ref={scrollWrapperRef}
      className="editor-canvas-wrapper h-full w-full flex overflow-auto bg-gray-100 dark:bg-gray-900"
    >
      {/* m-auto : centre la page quand elle est plus petite que le viewport
          (les marges auto se replient à 0 en cas d'overflow → coin haut-
          gauche toujours accessible). Le padding vit ICI pour faire partie
          de la zone scrollable : marge confortable aux 4 bords, même
          zoomé à fond. */}
      <div className="m-auto" style={{ padding: CANVAS_VIEWPORT_PADDING }}>
        <div
          ref={containerRef}
          className="canvas-container relative bg-white shadow-lg rounded-sm"
          style={{
            width: canvasWidth * zoom,
            height: canvasHeight * zoom,
          }}
        >
          <canvas ref={canvasRef} />

          {/* Overlay applicatif (ex: surlignage des champs en mode Remplir).
              Positionné dans le repère page×zoom, défile avec la page. */}
          {overlay ? (
            <div className="absolute inset-0 z-10 pointer-events-none">
              {overlay}
            </div>
          ) : null}

          {/* Mini-formulaire de création d'un groupe de boutons radio. */}
          {radioPrompt ? (
            <div
              className="absolute z-20 w-64 rounded-lg border bg-background p-3 shadow-xl"
              style={{
                left: Math.max(0, radioPrompt.x * zoom),
                top: Math.max(0, radioPrompt.y * zoom),
              }}
            >
              <h4 className="text-sm font-medium mb-2">
                {t("radioPrompt.title")}
              </h4>
              <label className="block text-xs text-muted-foreground mb-1">
                {t("radioPrompt.groupName")}
              </label>
              <input
                type="text"
                value={radioGroupName}
                onChange={(e) => setRadioGroupName(e.target.value)}
                className="w-full h-8 px-2 mb-2 rounded border bg-background text-sm"
              />
              <label className="block text-xs text-muted-foreground mb-1">
                {t("radioPrompt.options")}
              </label>
              <textarea
                value={radioOptionsText}
                onChange={(e) => setRadioOptionsText(e.target.value)}
                rows={4}
                className="w-full px-2 py-1 mb-1 rounded border bg-background text-sm resize-y"
              />
              <p className="text-[10px] text-muted-foreground mb-2">
                {t("radioPrompt.optionsHint")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRadioPrompt(null)}
                  className="px-2.5 py-1.5 rounded text-xs border hover:bg-muted transition-colors"
                >
                  {t("radioPrompt.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleConfirmRadioGroup();
                  }}
                  className="px-2.5 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {t("radioPrompt.create")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
