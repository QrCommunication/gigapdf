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
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
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
  /**
   * Calques utilisateur (Phase 2 "Layer Groups") — construction d'édition
   * uniquement (PAS des OCG PDF). Éditables : visibilité, verrou, renommage,
   * réordonnancement, suppression. Cliquer une ligne filtre la liste des
   * éléments ci-dessous sur ceux dont `layerId` vaut ce calque.
   */
  userLayers?: LayerObject[];
  /** IDs des éléments sélectionnés sur le canvas (surlignage des lignes) */
  selectedElementIds?: string[];
  onElementVisibilityChange?: (elementId: string, visible: boolean) => void;
  onElementLockChange?: (elementId: string, locked: boolean) => void;
  /**
   * Sélectionner un élément en cliquant sa ligne : surligne l'objet sur le
   * canvas et ouvre ses propriétés (comportement design-tool standard).
   */
  onElementSelect?: (elementId: string) => void;
  // --- User-layer actions (Phase 2). Absents ⇒ section "User Layers" masquée. ---
  onLayerCreate?: () => void;
  onLayerDelete?: (layerId: string) => void;
  onLayerRename?: (layerId: string, name: string) => void;
  onLayerReorder?: (layerId: string, newOrder: number) => void;
  onLayerVisibilityChange?: (layerId: string, visible: boolean) => void;
  onLayerLockChange?: (layerId: string, locked: boolean) => void;
  /** Affecter un élément à un calque utilisateur (ou `null` pour le détacher). */
  onAssignElementToLayer?: (elementId: string, layerId: string | null) => void;
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
 * Panneau des calques — section "User Layers" (calques d'édition Phase 2,
 * pleinement éditables) au-dessus de la liste des éléments de la page (œil /
 * cadenas / sélection), puis les groupes OCG du PDF en lecture seule.
 *
 * Composant contrôlé : l'état affiché vient du scene graph (element.visible /
 * element.locked) et des props `userLayers`, jamais d'un state local — le panel
 * reflète donc toujours la vérité du store, y compris après undo/redo ou
 * updates collaboratifs.
 */
export function LayersPanel({
  elements,
  layers = [],
  userLayers = [],
  selectedElementIds = [],
  onElementVisibilityChange,
  onElementLockChange,
  onElementSelect,
  onLayerCreate,
  onLayerDelete,
  onLayerRename,
  onLayerReorder,
  onLayerVisibilityChange,
  onLayerLockChange,
  onAssignElementToLayer,
  className,
}: LayersPanelProps) {
  const t = useTranslations("editor.layers");
  const [expanded, setExpanded] = useState(true);
  // Calque utilisateur actif : filtre la liste d'éléments ci-dessous (null = tous).
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  // Calque en cours de renommage inline (double-clic) + valeur du champ.
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // La section "User Layers" est disponible dès qu'une action d'édition de
  // calque est fournie (le bouton "+" reste utile même sans calque existant).
  const userLayersEnabled = Boolean(onLayerCreate);

  if (
    elements.length === 0 &&
    layers.length === 0 &&
    userLayers.length === 0 &&
    !userLayersEnabled
  ) {
    return null;
  }

  const typeLabels: Record<ElementType, string> = {
    text: t("typeText"),
    image: t("typeImage"),
    shape: t("typeShape"),
    annotation: t("typeAnnotation"),
    form_field: t("typeFormField"),
  };

  // Calques utilisateur triés par `order` décroissant (le plus haut en premier),
  // cohérent avec la convention "rendu au-dessus = listé en premier".
  const sortedUserLayers = [...userLayers].sort((a, b) => b.order - a.order);

  // Filtre par calque actif si l'utilisateur en a sélectionné un.
  const filteredElements =
    activeLayerId === null
      ? elements
      : elements.filter((el) => el.layerId === activeLayerId);

  // Ordre design-tool : l'élément rendu AU-DESSUS sur le canvas apparaît en
  // PREMIER dans le panneau (tri z-order descendant, stable par index).
  const ordered = filteredElements
    .map((el, idx) => ({ el, idx }))
    .sort((a, b) => {
      const ra = Z_ORDER_RANK[a.el.type] ?? 99;
      const rb = Z_ORDER_RANK[b.el.type] ?? 99;
      return ra !== rb ? rb - ra : b.idx - a.idx;
    })
    .map(({ el }) => el);

  const commitRename = (layerId: string) => {
    const next = renameValue.trim();
    if (next) {
      onLayerRename?.(layerId, next);
    }
    setRenamingLayerId(null);
  };

  const startRename = (layer: LayerObject) => {
    if (!onLayerRename) return;
    setRenamingLayerId(layer.layerId);
    setRenameValue(layer.name);
  };

  const handleCreate = () => {
    onLayerCreate?.();
  };

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
          {/* ---- User Layers (Phase 2 — éditables) ---- */}
          {userLayersEnabled && (
            <>
              <div className="flex items-center justify-between px-2 pt-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("userLayers")}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={handleCreate}
                  title={t("addLayer")}
                  aria-label={t("addLayer")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {sortedUserLayers.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t("noLayers")}
                </p>
              )}

              {sortedUserLayers.map((layer, index) => {
                const selected = activeLayerId === layer.layerId;
                const isRenaming = renamingLayerId === layer.layerId;
                return (
                  <div
                    key={layer.layerId}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setActiveLayerId(selected ? null : layer.layerId)
                    }
                    onDoubleClick={() => startRename(layer)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveLayerId(selected ? null : layer.layerId);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1 px-1 py-1 rounded-md text-sm cursor-pointer",
                      "hover:bg-accent transition-colors",
                      selected && "bg-accent",
                      !layer.visible && "opacity-50",
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLayerVisibilityChange?.(
                          layer.layerId,
                          !layer.visible,
                        );
                      }}
                      title={layer.visible ? t("hide") : t("show")}
                      aria-label={layer.visible ? t("hide") : t("show")}
                      aria-pressed={!layer.visible}
                    >
                      {layer.visible ? (
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
                        onLayerLockChange?.(layer.layerId, !layer.locked);
                      }}
                      title={layer.locked ? t("unlock") : t("lock")}
                      aria-label={layer.locked ? t("unlock") : t("lock")}
                      aria-pressed={layer.locked}
                    >
                      {layer.locked ? (
                        <Lock className="h-3.5 w-3.5 text-amber-500" />
                      ) : (
                        <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Button>

                    <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => commitRename(layer.layerId)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(layer.layerId);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenamingLayerId(null);
                          }
                        }}
                        className="flex-1 min-w-0 h-6 px-1 rounded border bg-background text-xs"
                        aria-label={t("renameLayer")}
                      />
                    ) : (
                      <span
                        className="flex-1 truncate text-xs"
                        title={layer.name}
                      >
                        {layer.name}
                      </span>
                    )}

                    {/* Réordonnancement : monter/descendre dans la pile.
                        Monter = augmenter `order` (échange avec le voisin du
                        dessus dans la liste triée décroissante). */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        const above = sortedUserLayers[index - 1];
                        if (above) {
                          onLayerReorder?.(layer.layerId, above.order);
                          onLayerReorder?.(above.layerId, layer.order);
                        }
                      }}
                      title={t("moveUp")}
                      aria-label={t("moveUp")}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      disabled={index === sortedUserLayers.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        const below = sortedUserLayers[index + 1];
                        if (below) {
                          onLayerReorder?.(layer.layerId, below.order);
                          onLayerReorder?.(below.layerId, layer.order);
                        }
                      }}
                      title={t("moveDown")}
                      aria-label={t("moveDown")}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeLayerId === layer.layerId) {
                          setActiveLayerId(null);
                        }
                        onLayerDelete?.(layer.layerId);
                      }}
                      title={t("deleteLayer")}
                      aria-label={t("deleteLayer")}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                );
              })}

              <div className="h-px bg-border my-1" />
            </>
          )}

          {/* ---- Éléments de la page (calques au sens design-tool) ---- */}
          {ordered.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {activeLayerId !== null ? t("noLayerElements") : t("noElements")}
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

                {/* Affectation à un calque utilisateur. Affiché uniquement
                    quand l'action + des calques existent. */}
                {onAssignElementToLayer && userLayers.length > 0 && (
                  <select
                    value={element.layerId ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      onAssignElementToLayer(
                        element.elementId,
                        e.target.value || null,
                      );
                    }}
                    className="h-6 max-w-[5rem] shrink-0 rounded border bg-background text-[10px]"
                    title={t("assignToLayer")}
                    aria-label={t("assignToLayer")}
                  >
                    <option value="">{t("layerNone")}</option>
                    {sortedUserLayers.map((layer) => (
                      <option key={layer.layerId} value={layer.layerId}>
                        {layer.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}

          {/* ---- Groupes OCG du PDF (lecture seule) ---- */}
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
