"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const DEFAULT_FONTS = [
  { value: "arial", label: "Arial", family: "Arial, sans-serif" },
  { value: "helvetica", label: "Helvetica", family: "Helvetica, sans-serif" },
  { value: "times", label: "Times New Roman", family: "'Times New Roman', serif" },
  { value: "courier", label: "Courier New", family: "'Courier New', monospace" },
  { value: "georgia", label: "Georgia", family: "Georgia, serif" },
  { value: "verdana", label: "Verdana", family: "Verdana, sans-serif" },
  { value: "palatino", label: "Palatino", family: "Palatino, serif" },
  { value: "garamond", label: "Garamond", family: "Garamond, serif" },
  { value: "bookman", label: "Bookman", family: "Bookman, serif" },
  { value: "comic-sans", label: "Comic Sans MS", family: "'Comic Sans MS', cursive" },
  { value: "trebuchet", label: "Trebuchet MS", family: "'Trebuchet MS', sans-serif" },
  { value: "impact", label: "Impact", family: "Impact, sans-serif" },
  { value: "lucida-console", label: "Lucida Console", family: "'Lucida Console', monospace" },
  { value: "tahoma", label: "Tahoma", family: "Tahoma, sans-serif" },
  { value: "century-gothic", label: "Century Gothic", family: "'Century Gothic', sans-serif" },
  { value: "optima", label: "Optima", family: "Optima, sans-serif" },
  { value: "futura", label: "Futura", family: "Futura, sans-serif" },
  { value: "rockwell", label: "Rockwell", family: "Rockwell, serif" },
  { value: "baskerville", label: "Baskerville", family: "Baskerville, serif" },
  { value: "didot", label: "Didot", family: "Didot, serif" },
];

export interface FontOption {
  value: string;
  label: string;
  family: string;
}

export interface FontPickerProps {
  value?: string;
  onChange?: (font: FontOption) => void;
  fonts?: FontOption[];
  className?: string;
  placeholder?: string;
}

const FontPicker = React.forwardRef<HTMLButtonElement, FontPickerProps>(
  ({ value, onChange, fonts = DEFAULT_FONTS, className, placeholder = "Select font..." }, ref) => {
    const [open, setOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");

    const selectedFont = React.useMemo(
      () => fonts.find((font) => font.value === value),
      [value, fonts]
    );

    const filteredFonts = React.useMemo(() => {
      if (!searchQuery) return fonts;
      return fonts.filter((font) =>
        font.label.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }, [fonts, searchQuery]);

    const handleSelect = (font: FontOption) => {
      onChange?.(font);
      setOpen(false);
      setSearchQuery("");
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-[200px] justify-between", className)}
          >
            <span
              className="truncate"
              style={{ fontFamily: selectedFont?.family }}
            >
              {selectedFont?.label || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search fonts..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>No font found.</CommandEmpty>
              <CommandGroup>
                {filteredFonts.map((font) => (
                  <CommandItem
                    key={font.value}
                    value={font.value}
                    onSelect={() => handleSelect(font)}
                    className="cursor-pointer"
                    style={{ fontFamily: font.family }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedFont?.value === font.value
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    {font.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
);
FontPicker.displayName = "FontPicker";

export { FontPicker, DEFAULT_FONTS };
