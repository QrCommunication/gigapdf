"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Trash2,
  Highlighter,
  Underline,
  Strikethrough,
  StickyNote,
  Type as TypeIcon,
  Stamp,
  Minus,
  ArrowUpRight,
  Link2,
  Squircle,
  Circle,
  Hexagon,
  Spline,
  ChevronUp,
  Shapes,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";
import type { AnnotationElement, AnnotationType, Element } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

/**
 * Geometric annotation kinds the panel can create. Each maps 1:1 to a
 * `GigaPdfDoc` add method behind `POST /api/pdf/annotations` (`action`):
 * circle → addCircleAnnotation, polygon → addPolygonAnnotation,
 * polyline → addPolylineAnnotation, caret → addCaretAnnotation.
 */
export type GeometricAnnotationType = "circle" | "polygon" | "polyline" | "caret";

/** Add-toolbar entries: icon + i18n key suffix, in display order. */
const GEOMETRIC_ADD_ACTIONS: ReadonlyArray<{
  type: GeometricAnnotationType;
  icon: typeof Circle;
  /** i18n key under `editor.annotations` (e.g. "addCircle"). */
  labelKey: string;
}> = [
  { type: "circle", icon: Circle, labelKey: "addCircle" },
  { type: "polygon", icon: Hexagon, labelKey: "addPolygon" },
  { type: "polyline", icon: Spline, labelKey: "addPolyline" },
  { type: "caret", icon: ChevronUp, labelKey: "addCaret" },
];

/**
 * One existing annotation surfaced by the engine's per-page inventory
 * (`POST /api/pdf/annotations` `action="list"` → `GigaPdfDoc.annotations`).
 * `page` is 1-based and `index` is the per-page `/Annots` position — exactly the
 * pair `removeAnnotation(page, index)` needs for a clean structural removal.
 */
export interface NativeAnnotationItem {
  page: number;
  index: number;
  /** Raw PDF subtype, e.g. "Highlight", "Square", "Link". */
  subtype: string;
  contents: string;
  author: string;
}

/**
 * The geometric-annotation add toolbar (circle / polygon / polyline / caret),
 * shared by both the scene-graph and native-inventory panels. The backend
 * places each shape with a default centred geometry; the user repositions it
 * with the selection tool afterwards (no free drawing tool).
 */
function GeometricAddToolbar({
  onAdd,
  addBusy,
}: {
  onAdd: (type: GeometricAnnotationType) => void;
  addBusy: boolean;
}) {
  const t = useTranslations("editor.annotations");
  return (
    <div className="mb-1 space-y-1.5">
      <div className="flex items-center gap-1">
        {GEOMETRIC_ADD_ACTIONS.map(({ type, icon: Icon, labelKey }) => {
          const label = t(labelKey);
          return (
            <Button
              key={type}
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={addBusy}
              onClick={() => onAdd(type)}
              title={label}
              aria-label={label}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </Button>
          );
        })}
      </div>
      <p className="flex items-start gap-1 text-[10px] leading-snug text-muted-foreground">
        <Shapes className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>{t("addHint")}</span>
      </p>
    </div>
  );
}

interface AnnotationsPanelProps {
  /**
   * Éléments de la page courante. Le panneau ne s'intéresse qu'aux
   * `type === "annotation"` (annotations existantes du PDF surfacées par le
   * parser) — les autres sont ignorés.
   */
  elements: Element[];
  /** IDs des éléments sélectionnés sur le canvas (surlignage des lignes). */
  selectedElementIds?: string[];
  /**
   * Sélectionner une annotation en cliquant sa ligne : surligne l'objet sur le
   * canvas et le centre dans la vue (navigation vers l'annotation).
   */
  onSelect?: (elementId: string) => void;
  /**
   * Supprimer une annotation ciblée. Absent ⇒ la liste reste consultable mais
   * sans bouton de suppression (lecture seule).
   */
  onDelete?: (elementId: string) => void;
  /**
   * Ajouter une annotation géométrique (cercle / polygone / ligne brisée /
   * caret) à la page courante. Le backend la place avec une géométrie par défaut
   * centrée sur la page ; l'utilisateur la repositionne ensuite via le système de
   * sélection existant (pas d'outil de dessin libre). Absent ⇒ la barre d'ajout
   * est masquée (le panneau reste en lecture/suppression seule).
   */
  onAdd?: (type: GeometricAnnotationType) => void;
  /** Une création est en cours — désactive la barre d'ajout. */
  addBusy?: boolean;
  /**
   * Inventaire NATIF des annotations du document (toutes pages) via
   * `GigaPdfDoc.annotations` — chaque item porte son couple `{page, index}`.
   * Quand fourni, le panneau bascule en mode natif : il liste ce que renvoie
   * cette fonction (chargée au montage + rafraîchissement) au lieu du scene
   * graph, et supprime via {@link onRemoveAnnotation} (suppression structurelle
   * `removeAnnotation`, pas une redaction). Absent ⇒ mode scene-graph (legacy).
   */
  onListAnnotations?: () => Promise<NativeAnnotationItem[]>;
  /**
   * Supprimer nativement l'annotation `index` de la page `page` (résout sur
   * `removeAnnotation`). Utilisé uniquement en mode natif (avec
   * {@link onListAnnotations}). La promesse se résout une fois le PDF adopté ;
   * le panneau rafraîchit alors sa liste.
   */
  onRemoveAnnotation?: (page: number, index: number) => Promise<void> | void;
  className?: string;
}

const TYPE_ICONS: Record<AnnotationType, typeof MessageSquare> = {
  highlight: Highlighter,
  underline: Underline,
  strikeout: Strikethrough,
  strikethrough: Strikethrough,
  squiggly: Underline,
  note: StickyNote,
  comment: MessageSquare,
  freetext: TypeIcon,
  stamp: Stamp,
  line: Minus,
  arrow: ArrowUpRight,
  link: Link2,
};

/** i18n key per annotation type (matches the `editor.annotations.type*` keys). */
const TYPE_LABEL_KEY: Record<AnnotationType, string> = {
  highlight: "typeHighlight",
  underline: "typeUnderline",
  strikeout: "typeStrikeout",
  strikethrough: "typeStrikethrough",
  squiggly: "typeSquiggly",
  note: "typeNote",
  comment: "typeComment",
  freetext: "typeFreetext",
  stamp: "typeStamp",
  line: "typeLine",
  arrow: "typeArrow",
  link: "typeLink",
};

/** Returns the page's annotation elements, narrowed from the mixed scene graph. */
function annotationsOf(elements: Element[]): AnnotationElement[] {
  return elements.filter(
    (el): el is AnnotationElement => el.type === "annotation",
  );
}

/**
 * Panneau des annotations existantes du PDF — liste consultable + navigation
 * (clic = sélectionner/centrer sur le canvas) + suppression ciblée. Composant
 * contrôlé : la liste vient toujours du scene graph (props), jamais d'un state
 * local — elle reflète donc undo/redo, suppressions et updates collaboratifs.
 *
 * Distinct du panneau des CALQUES : ici on révise les annotations existantes
 * (highlights, notes, liens…), on ne crée pas. La suppression réutilise le flux
 * de suppression d'élément de l'éditeur (redaction + re-bake), pas un chemin neuf.
 */
export function AnnotationsPanel({
  elements,
  selectedElementIds = [],
  onSelect,
  onDelete,
  onAdd,
  addBusy = false,
  onListAnnotations,
  onRemoveAnnotation,
  className,
}: AnnotationsPanelProps) {
  const t = useTranslations("editor.annotations");
  const [expanded, setExpanded] = useState(true);

  // Native inventory mode: the engine's per-page annotation list drives the
  // panel (all pages, structural `removeAnnotation`). Rendered by a dedicated
  // component so its data hooks live outside this scene-graph render path.
  if (onListAnnotations) {
    return (
      <NativeAnnotationsPanel
        onListAnnotations={onListAnnotations}
        onRemoveAnnotation={onRemoveAnnotation}
        onAdd={onAdd}
        addBusy={addBusy}
        className={className}
      />
    );
  }

  const annotations = annotationsOf(elements);
  const canAdd = Boolean(onAdd);

  // Hide entirely only when there is nothing to review AND no way to add — keep
  // the panel reachable when the add toolbar is wired, even on a page with no
  // existing annotations.
  if (annotations.length === 0 && !canAdd) return null;

  return (
    <div className={cn("border-b", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span>{t("title")}</span>
          <span className="text-xs text-muted-foreground">
            ({annotations.length})
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {/* Add a geometric annotation (centred default geometry; the user then
              repositions it with the selection tool). */}
          {canAdd && onAdd && (
            <GeometricAddToolbar onAdd={onAdd} addBusy={addBusy} />
          )}

          {annotations.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("empty")}</p>
          )}

          {annotations.map((annotation) => {
            const selected = selectedElementIds.includes(annotation.elementId);
            const TypeIconCmp = TYPE_ICONS[annotation.annotationType] ?? Squircle;
            const typeLabel = t(
              TYPE_LABEL_KEY[annotation.annotationType] ?? "typeNote",
            );
            // Primary line: the annotation's own text, else its type label.
            const primary = annotation.content?.trim()
              ? annotation.content.trim()
              : typeLabel;
            return (
              <div
                key={annotation.elementId}
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-selected={onSelect ? selected : undefined}
                onClick={() => onSelect?.(annotation.elementId)}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelect(annotation.elementId);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                  onSelect && "cursor-pointer",
                  selected
                    ? "bg-primary/15 ring-1 ring-inset ring-primary font-medium"
                    : "hover:bg-accent",
                )}
              >
                <TypeIconCmp
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs" title={primary}>
                    {primary}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {typeLabel}
                    {annotation.author
                      ? ` · ${t("byAuthor", { author: annotation.author })}`
                      : ""}
                  </span>
                </span>

                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(annotation.elementId);
                    }}
                    title={t("delete")}
                    aria-label={t("delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Lucide icon for a raw PDF annotation subtype (best-effort, falls back). */
function iconForSubtype(subtype: string): typeof MessageSquare {
  switch (subtype.toLowerCase()) {
    case "highlight":
      return Highlighter;
    case "underline":
      return Underline;
    case "strikeout":
      return Strikethrough;
    case "squiggly":
      return Underline;
    case "text":
      return StickyNote;
    case "freetext":
      return TypeIcon;
    case "link":
      return Link2;
    case "stamp":
      return Stamp;
    case "line":
      return Minus;
    case "caret":
      return ChevronUp;
    case "polygon":
      return Hexagon;
    case "polyline":
      return Spline;
    case "circle":
      return Circle;
    default:
      return Squircle;
  }
}

/**
 * Native-inventory variant of the annotations panel. Lists the engine's
 * per-page annotations (all pages) fetched via {@link onListAnnotations} on
 * mount + on manual refresh + after each removal, and deletes structurally via
 * {@link onRemoveAnnotation} (`removeAnnotation(page, index)`). The geometric
 * add toolbar ({@link onAdd}) is preserved. Distinct from the scene-graph
 * variant: items carry an authoritative `{page, index}`, not an `elementId`, so
 * there is no canvas-selection navigation here.
 */
function NativeAnnotationsPanel({
  onListAnnotations,
  onRemoveAnnotation,
  onAdd,
  addBusy,
  className,
}: {
  onListAnnotations: () => Promise<NativeAnnotationItem[]>;
  onRemoveAnnotation?: (page: number, index: number) => Promise<void> | void;
  onAdd?: (type: GeometricAnnotationType) => void;
  addBusy: boolean;
  className?: string;
}) {
  const t = useTranslations("editor.annotations");
  const [expanded, setExpanded] = useState(true);
  const [items, setItems] = useState<NativeAnnotationItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Key (`page:index`) of the row whose removal is in flight — disables its
  // delete button. Cleared on refresh.
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await onListAnnotations();
      setItems(next);
    } catch {
      // Keep the last good list on a transient failure rather than blanking it.
    } finally {
      setLoading(false);
      setRemovingKey(null);
    }
  }, [onListAnnotations]);

  // Load on mount and whenever the fetcher identity changes (e.g. the active
  // document was swapped). Errors are swallowed by `refresh`.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRemove = useCallback(
    async (item: NativeAnnotationItem) => {
      if (!onRemoveAnnotation) return;
      setRemovingKey(`${item.page}:${item.index}`);
      try {
        await onRemoveAnnotation(item.page, item.index);
      } finally {
        // Re-read the inventory from the freshly adopted PDF; per-page indices
        // shift after a removal, so the stale list must be rebuilt, not patched.
        await refresh();
      }
    },
    [onRemoveAnnotation, refresh],
  );

  const canAdd = Boolean(onAdd);
  // Hide entirely only when there is nothing to review AND no way to add.
  if (items.length === 0 && !canAdd && !loading) return null;

  return (
    <div className={cn("border-b", className)}>
      <div className="flex items-center justify-between w-full pl-3 pr-1 py-2 text-sm font-medium">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity"
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          <span>{t("title")}</span>
          <span className="text-xs text-muted-foreground">({items.length})</span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 ml-auto" />
          ) : (
            <ChevronRight className="h-4 w-4 ml-auto" />
          )}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          disabled={loading}
          onClick={() => void refresh()}
          title={t("refresh")}
          aria-label={t("refresh")}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {canAdd && onAdd && (
            <GeometricAddToolbar onAdd={onAdd} addBusy={addBusy} />
          )}

          {items.length === 0 && !loading && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("empty")}</p>
          )}

          {items.map((item) => {
            const Icon = iconForSubtype(item.subtype);
            const key = `${item.page}:${item.index}`;
            const primary = item.contents.trim() || item.subtype;
            return (
              <div
                key={key}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors"
              >
                <Icon
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs" title={primary}>
                    {primary}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t("pageBadge", { page: item.page })} · {item.subtype}
                    {item.author
                      ? ` · ${t("byAuthor", { author: item.author })}`
                      : ""}
                  </span>
                </span>

                {onRemoveAnnotation && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    disabled={removingKey === key}
                    onClick={() => void handleRemove(item)}
                    title={t("delete")}
                    aria-label={t("delete")}
                  >
                    {removingKey === key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
