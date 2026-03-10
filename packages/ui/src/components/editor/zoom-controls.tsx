import * as React from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

const ZOOM_LEVELS = [
  { value: "25", label: "25%" },
  { value: "50", label: "50%" },
  { value: "75", label: "75%" },
  { value: "100", label: "100%" },
  { value: "125", label: "125%" },
  { value: "150", label: "150%" },
  { value: "200", label: "200%" },
  { value: "300", label: "300%" },
  { value: "fit-width", label: "Fit Width" },
  { value: "fit-page", label: "Fit Page" },
];

export interface ZoomControlsProps extends React.HTMLAttributes<HTMLDivElement> {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitWidth?: () => void;
  onFitPage?: () => void;
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
}

const ZoomControls = React.forwardRef<HTMLDivElement, ZoomControlsProps>(
  (
    {
      className,
      zoom,
      onZoomChange,
      onFitWidth,
      onFitPage,
      minZoom = 25,
      maxZoom = 300,
      zoomStep = 25,
      ...props
    },
    ref
  ) => {
    const handleZoomIn = () => {
      const newZoom = Math.min(zoom + zoomStep, maxZoom);
      onZoomChange(newZoom);
    };

    const handleZoomOut = () => {
      const newZoom = Math.max(zoom - zoomStep, minZoom);
      onZoomChange(newZoom);
    };

    const handleSelectChange = (value: string) => {
      if (value === "fit-width" && onFitWidth) {
        onFitWidth();
      } else if (value === "fit-page" && onFitPage) {
        onFitPage();
      } else {
        const zoomValue = parseInt(value, 10);
        if (!isNaN(zoomValue)) {
          onZoomChange(zoomValue);
        }
      }
    };

    const currentZoomValue = ZOOM_LEVELS.find(
      (level) => level.value === zoom.toString()
    )
      ? zoom.toString()
      : "100";

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-1", className)}
        {...props}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={handleZoomOut}
          disabled={zoom <= minZoom}
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </Button>

        <Select value={currentZoomValue} onValueChange={handleSelectChange}>
          <SelectTrigger className="h-8 w-[120px]" aria-label="Zoom level">
            <SelectValue placeholder="100%" />
          </SelectTrigger>
          <SelectContent>
            {ZOOM_LEVELS.map((level) => (
              <SelectItem key={level.value} value={level.value}>
                {level.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleZoomIn}
          disabled={zoom >= maxZoom}
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </Button>

        {onFitPage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onFitPage}
            aria-label="Fit to page"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }
);
ZoomControls.displayName = "ZoomControls";

export { ZoomControls };
