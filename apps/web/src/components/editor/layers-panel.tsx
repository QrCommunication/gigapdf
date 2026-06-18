"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronRight,
  ChevronDown,
  Type,
  Image as ImageIcon,
  Square,
  StickyNote,
  FormInput,
} from "lucide-react";
import { Button } from "@giga-pdf/ui";
import type { Element, ElementType, LayerObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

interface LayersPanelProps {
  /**
   * Éléments de la page courante. Chaque élément est un "calque" au sens
   * design-tool (pattern Figma/Photoshop) : l'œil pilote element.visible,
   * le cadenas element.locked. Les LayerObject OCG du PDF ne sont PAS
   * reliés aux éléments (les extracteurs produisent layerId: null) — ils
   * sont affichés à part, en lecture seule.
   */
  elements: Element[];
  /** Groupes OCG du PDF (informatif, lecture seule) */
  layers?: LayerObject[];
  /** IDs des éléments sélectionnés sur le canvas (surlignage des lignes) */
  selectedElementIds?: string[];
  onElementVisibilityChange?: (elementId: string, visible: boolean) => void;
  onElementLockChange?: (elementId: string, locked: boolean) => void;
  /**
   * Sélectionner un élément en cliquant sa ligne : surligne l'objet sur le
   * canvas et ouvre ses propriétés (comportement design-tool standard).
   */
  onElementSelect?: (elementId: string) => void;
  className?: string;
}

const TYPE_ICONS: Record<ElementType, typeof Type> = {
  text: Type,
  image: ImageIcon,
  shape: Square,
  annotation: StickyNote,
  form_field: FormInput,
};

// Même classement z-order que le renderer du canvas (editor-canvas
// renderElementsOverlay) : shape < image < text < annotation < form_field.
const Z_ORDER_RANK: Record<string, number> = {
  shape: 0,
  image: 1,
  draw: 2,
  text: 3,
  annotation: 4,
  form_field: 5,
};

/** Libellé d'une ligne : extrait du contenu pour le texte, type traduit sinon. */
function elementLabel(element: Element, typeLabel: string): string {
  if (element.type === "text" && element.content?.trim()) {
    const text = element.content.trim();
    return text.length > 30 ? `${text.slice(0, 30)}…` : text;
  }
  return typeLabel;
}

/**
 * Panneau des calques — liste les éléments de la page courante avec
 * toggles visibilité (œil) et verrouillage (cadenas). Composant contrôlé :
 * l'état affiché vient de element.visible/element.locked (scene graph),
 * jamais d'un state local — le panel reflète donc toujours la vérité du
 * canvas, y compris après undo/redo ou updates collaboratifs.
 */
export function LayersPanel({
  elements,
  layers = [],
  selectedElementIds = [],
  onElementVisibilityChange,
  onElementLockChange,
  onElementSelect,
  className,
}: LayersPanelProps) {
  const t = useTranslations("editor.layers");
  const [expanded, setExpanded] = useState(true);

  if (elements.length === 0 && layers.length === 0) {
    return null;
  }

  const typeLabels: Record<ElementType, string> = {
    text: t("typeText"),
    image: t("typeImage"),
    shape: t("typeShape"),
    annotation: t("typeAnnotation"),
    form_field: t("typeFormField"),
  };

  // Ordre design-tool : l'élément rendu AU-DESSUS sur le canvas apparaît en
  // PREMIER dans le panneau (tri z-order descendant, stable par index).
  const ordered = elements
    .map((el, idx) => ({ el, idx }))
    .sort((a, b) => {
      const ra = Z_ORDER_RANK[a.el.type] ?? 99;
      const rb = Z_ORDER_RANK[b.el.type] ?? 99;
      return ra !== rb ? rb - ra : b.idx - a.idx;
    })
    .map(({ el }) => el);

  return (
    <div className={cn("border-b", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          <span>{t("title")}</span>
          <span className="text-xs text-muted-foreground">
            ({ordered.length})
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
          {ordered.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("noElements")}
            </p>
          )}

          {ordered.map((element) => {
            const visible = element.visible !== false;
            const locked = element.locked === true;
            const selected = selectedElementIds.includes(element.elementId);
            const TypeIcon = TYPE_ICONS[element.type] ?? Square;
            const label = elementLabel(element, typeLabels[element.type]);
            return (
              <div
                key={element.elementId}
                role={onElementSelect ? "button" : undefined}
                tabIndex={onElementSelect ? 0 : undefined}
                onClick={() => onElementSelect?.(element.elementId)}
                onKeyDown={(e) => {
                  if (onElementSelect && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onElementSelect(element.elementId);
                  }
                }}
                className={cn(
                  "flex items-center gap-1 px-1 py-1 rounded-md text-sm",
                  "hover:bg-accent transition-colors",
                  onElementSelect && "cursor-pointer",
                  selected && "bg-accent",
                  !visible && "opacity-50",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onElementVisibilityChange?.(element.elementId, !visible);
                  }}
                  title={visible ? t("hide") : t("show")}
                  aria-label={visible ? t("hide") : t("show")}
                  aria-pressed={!visible}
                >
                  {visible ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onElementLockChange?.(element.elementId, !locked);
                  }}
                  title={locked ? t("unlock") : t("lock")}
                  aria-label={locked ? t("unlock") : t("lock")}
                  aria-pressed={locked}
                >
                  {locked ? (
                    <Lock className="h-3.5 w-3.5 text-amber-500" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </Button>

                <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-xs" title={label}>
                  {label}
                </span>
              </div>
            );
          })}

          {layers.length > 0 && (
            <>
              <p className="px-2 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("ocgGroups")}
              </p>
              {[...layers]
                .sort((a, b) => a.order - b.order)
                .map((layer) => (
                  <div
                    key={layer.layerId}
                    className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border shrink-0"
                      style={{ opacity: layer.opacity }}
                    />
                    <span className="flex-1 truncate" title={layer.name}>
                      {layer.name}
                    </span>
                  </div>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
