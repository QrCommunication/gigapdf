import * as React from "react";
import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const DEFAULT_COLORS = [
  "#000000",
  "#FFFFFF",
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF00FF",
  "#00FFFF",
  "#FFA500",
  "#800080",
  "#008000",
  "#000080",
  "#808080",
  "#C0C0C0",
  "#800000",
  "#808000",
];

export interface ColorPickerProps {
  value?: string;
  onChange?: (color: string) => void;
  colors?: string[];
  showInput?: boolean;
  className?: string;
}

const ColorPicker = React.forwardRef<HTMLButtonElement, ColorPickerProps>(
  (
    {
      value = "#000000",
      onChange,
      colors = DEFAULT_COLORS,
      showInput = true,
      className,
    },
    ref
  ) => {
    const [selectedColor, setSelectedColor] = React.useState(value);
    const [customColor, setCustomColor] = React.useState(value);

    React.useEffect(() => {
      setSelectedColor(value);
      setCustomColor(value);
    }, [value]);

    const handleColorChange = (color: string) => {
      setSelectedColor(color);
      setCustomColor(color);
      onChange?.(color);
    };

    const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const color = e.target.value;
      setCustomColor(color);
      setSelectedColor(color);
      onChange?.(color);
    };

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            variant="outline"
            className={cn("w-[60px] p-1", className)}
            aria-label="Pick a color"
          >
            <div className="flex h-full w-full items-center justify-center gap-2">
              <div
                className="h-6 w-6 rounded border border-border"
                style={{ backgroundColor: selectedColor }}
              />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="space-y-3">
            <div className="grid grid-cols-8 gap-2">
              {colors.map((color) => (
                <button
                  key={color}
                  className={cn(
                    "h-8 w-8 rounded border border-border transition-all hover:scale-110",
                    selectedColor === color && "ring-2 ring-ring ring-offset-2"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => handleColorChange(color)}
                  aria-label={`Select color ${color}`}
                />
              ))}
            </div>
            {showInput && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Custom Color</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={customColor}
                    onChange={handleCustomColorChange}
                    placeholder="#000000"
                    className="flex-1"
                  />
                  <input
                    type="color"
                    value={customColor}
                    onChange={handleCustomColorChange}
                    className="h-10 w-10 cursor-pointer rounded border border-input"
                  />
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);
ColorPicker.displayName = "ColorPicker";

export { ColorPicker };
