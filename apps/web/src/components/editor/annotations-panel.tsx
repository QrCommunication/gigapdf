"use client";

import { useState } from "react";
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
  className,
}: AnnotationsPanelProps) {
  const t = useTranslations("editor.annotations");
  const [expanded, setExpanded] = useState(true);

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
          {canAdd && (
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
                      onClick={() => onAdd?.(type)}
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
