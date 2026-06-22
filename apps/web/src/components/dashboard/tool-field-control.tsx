"use client";

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
} from "@giga-pdf/ui";
import type { ToolField } from "./tool-runner-types";

/**
 * Renders a single tool option input (text, password, select, switch, slider
 * or file) from a {@link ToolField}. Shared by both the file-based
 * {@link import("./tool-runner").ToolRunner} and the text/URL
 * {@link import("./tool-text-runner").ToolTextRunner} so option controls look
 * and behave identically regardless of the primary input.
 *
 * Stateless: the parent owns the value/file and receives changes via the
 * `onValueChange` / `onFileChange` callbacks.
 */

export interface ToolFieldControlProps {
  field: ToolField;
  disabled: boolean;
  value: string;
  file: File | null;
  onValueChange: (name: string, value: string) => void;
  onFileChange: (name: string, file: File | null) => void;
  t: (key: string) => string;
}

export function ToolFieldControl({
  field,
  disabled,
  value,
  file,
  onValueChange,
  onFileChange,
  t,
}: ToolFieldControlProps) {
  const id = `tool-field-${field.name}`;
  const description = field.descriptionKey ? t(field.descriptionKey) : null;

  if (field.type === "switch") {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor={id}>{t(field.labelKey)}</Label>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <Switch
          id={id}
          checked={value === "true"}
          onCheckedChange={(checked) =>
            onValueChange(field.name, checked ? "true" : "false")
          }
          disabled={disabled}
        />
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{t(field.labelKey)}</Label>
        <Select
          value={value}
          onValueChange={(next) => onValueChange(field.name, next)}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            <SelectValue
              placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    );
  }

  if (field.type === "slider") {
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const step = field.step ?? 1;
    const numeric = Number(value);
    const current = Number.isFinite(numeric) ? numeric : min;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={id}>{t(field.labelKey)}</Label>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {current}
          </span>
        </div>
        <Slider
          id={id}
          min={min}
          max={max}
          step={step}
          value={[current]}
          onValueChange={(values) =>
            onValueChange(field.name, String(values[0] ?? min))
          }
          disabled={disabled}
        />
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    );
  }

  if (field.type === "file") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{t(field.labelKey)}</Label>
        <Input
          id={id}
          type="file"
          accept={field.accept}
          disabled={disabled}
          onChange={(e) => onFileChange(field.name, e.target.files?.[0] ?? null)}
        />
        {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    );
  }

  // text | password
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(field.labelKey)}</Label>
      <Input
        id={id}
        type={field.type === "password" ? "password" : "text"}
        value={value}
        onChange={(e) => onValueChange(field.name, e.target.value)}
        placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
        disabled={disabled}
        autoComplete={field.type === "password" ? "new-password" : "off"}
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
