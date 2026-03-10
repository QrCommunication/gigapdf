import * as React from "react";
import { Eye, EyeOff, Lock, Unlock, Trash2, GripVertical } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  type?: string;
}

export interface LayersPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  layers: Layer[];
  selectedLayerId?: string;
  onLayerSelect?: (layerId: string) => void;
  onLayerVisibilityToggle?: (layerId: string) => void;
  onLayerLockToggle?: (layerId: string) => void;
  onLayerDelete?: (layerId: string) => void;
  onLayerReorder?: (layerId: string, newIndex: number) => void;
}

const LayersPanel = React.forwardRef<HTMLDivElement, LayersPanelProps>(
  (
    {
      className,
      layers,
      selectedLayerId,
      onLayerSelect,
      onLayerVisibilityToggle,
      onLayerLockToggle,
      onLayerDelete,
      onLayerReorder,
      ...props
    },
    ref
  ) => {
    const [draggedLayer, setDraggedLayer] = React.useState<string | null>(null);

    const handleDragStart = (e: React.DragEvent, layerId: string) => {
      setDraggedLayer(layerId);
      e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
      e.preventDefault();
      if (draggedLayer && draggedLayer !== targetLayerId && onLayerReorder) {
        const targetIndex = layers.findIndex((l) => l.id === targetLayerId);
        onLayerReorder(draggedLayer, targetIndex);
      }
      setDraggedLayer(null);
    };

    return (
      <div
        ref={ref}
        className={cn("flex h-full flex-col border-l bg-background", className)}
        {...props}
      >
        <div className="border-b p-3">
          <h3 className="text-sm font-semibold">Layers</h3>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {layers.map((layer) => (
              <div
                key={layer.id}
                draggable={!layer.locked}
                onDragStart={(e) => handleDragStart(e, layer.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, layer.id)}
                className={cn(
                  "group flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-accent",
                  selectedLayerId === layer.id && "bg-accent",
                  draggedLayer === layer.id && "opacity-50"
                )}
              >
                <button
                  className="cursor-grab active:cursor-grabbing"
                  aria-label="Drag to reorder"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                </button>

                <button
                  className="flex-1 truncate text-left text-sm"
                  onClick={() => onLayerSelect?.(layer.id)}
                >
                  <span className={cn(!layer.visible && "opacity-50")}>
                    {layer.name}
                  </span>
                  {layer.type && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({layer.type})
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onLayerVisibilityToggle?.(layer.id)}
                    aria-label={layer.visible ? "Hide layer" : "Show layer"}
                  >
                    {layer.visible ? (
                      <Eye className="h-3 w-3" />
                    ) : (
                      <EyeOff className="h-3 w-3" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onLayerLockToggle?.(layer.id)}
                    aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
                  >
                    {layer.locked ? (
                      <Lock className="h-3 w-3" />
                    ) : (
                      <Unlock className="h-3 w-3" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={() => onLayerDelete?.(layer.id)}
                    aria-label="Delete layer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }
);
LayersPanel.displayName = "LayersPanel";

export { LayersPanel };
