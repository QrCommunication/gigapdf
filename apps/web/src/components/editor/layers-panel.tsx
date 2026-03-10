"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Layers, Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@giga-pdf/ui";
import type { LayerObject } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

interface LayersPanelProps {
  layers: LayerObject[];
  onLayerVisibilityChange?: (layerId: string, visible: boolean) => void;
  onLayerLockChange?: (layerId: string, locked: boolean) => void;
  className?: string;
}

/**
 * Panneau des calques (OCG) - Permet d'afficher/masquer les calques PDF.
 */
export function LayersPanel({
  layers,
  onLayerVisibilityChange,
  onLayerLockChange,
  className,
}: LayersPanelProps) {
  const t = useTranslations("editor.layers");
  const [expanded, setExpanded] = useState(true);
  const [layerStates, setLayerStates] = useState<Record<string, { visible: boolean; locked: boolean }>>(() => {
    const states: Record<string, { visible: boolean; locked: boolean }> = {};
    layers.forEach((layer) => {
      states[layer.layerId] = { visible: layer.visible, locked: layer.locked };
    });
    return states;
  });

  const toggleVisibility = useCallback((layerId: string) => {
    setLayerStates((prev) => {
      const newState = { ...prev };
      if (newState[layerId]) {
        newState[layerId] = { ...newState[layerId], visible: !newState[layerId].visible };
      }
      return newState;
    });
    const currentState = layerStates[layerId];
    if (currentState && onLayerVisibilityChange) {
      onLayerVisibilityChange(layerId, !currentState.visible);
    }
  }, [layerStates, onLayerVisibilityChange]);

  const toggleLock = useCallback((layerId: string) => {
    setLayerStates((prev) => {
      const newState = { ...prev };
      if (newState[layerId]) {
        newState[layerId] = { ...newState[layerId], locked: !newState[layerId].locked };
      }
      return newState;
    });
    const currentState = layerStates[layerId];
    if (currentState && onLayerLockChange) {
      onLayerLockChange(layerId, !currentState.locked);
    }
  }, [layerStates, onLayerLockChange]);

  if (layers.length === 0) {
    return null;
  }

  return (
    <div className={cn("border-b", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          <span>{t("title")}</span>
          <span className="text-xs text-muted-foreground">({layers.length})</span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {layers
            .sort((a, b) => a.order - b.order)
            .map((layer) => {
              const state = layerStates[layer.layerId] || { visible: layer.visible, locked: layer.locked };
              return (
                <div
                  key={layer.layerId}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
                    "hover:bg-accent transition-colors",
                    !state.visible && "opacity-50"
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => toggleVisibility(layer.layerId)}
                    title={state.visible ? t("hide") : t("show")}
                  >
                    {state.visible ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => toggleLock(layer.layerId)}
                    title={state.locked ? t("unlock") : t("lock")}
                  >
                    {state.locked ? (
                      <Lock className="h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>

                  <span className="flex-1 truncate" title={layer.name}>
                    {layer.name}
                  </span>

                  <span
                    className="w-3 h-3 rounded-full border"
                    style={{
                      opacity: layer.opacity,
                      backgroundColor: state.visible ? "#3b82f6" : "#9ca3af"
                    }}
                  />
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
