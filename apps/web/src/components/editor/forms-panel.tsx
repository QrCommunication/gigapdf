"use client";

import { useState, useCallback } from "react";
import {
  FileText,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  CheckSquare,
  List,
  Type,
  Radio,
  PenLine,
  Wand2,
  ScanSearch,
} from "lucide-react";
import { useGetFormFields, useFillFormFields, downloadBlob } from "@giga-pdf/api";
import type { FormFieldsResult } from "@giga-pdf/api";
import type { FormFieldElement, FieldType } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FormsPanelProps {
  currentFile: File | null;
  onPdfUpdated?: (blob: Blob) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFieldIcon(fieldType: FieldType) {
  switch (fieldType) {
    case "text":
      return Type;
    case "checkbox":
      return CheckSquare;
    case "radio":
      return Radio;
    case "dropdown":
    case "listbox":
      return List;
    case "signature":
      return PenLine;
    default:
      return FileText;
  }
}

function getFieldTypeLabel(fieldType: FieldType): string {
  const labels: Record<FieldType, string> = {
    text: "Text",
    checkbox: "Checkbox",
    radio: "Radio",
    dropdown: "Dropdown",
    listbox: "List",
    signature: "Signature",
    button: "Button",
  };
  return labels[fieldType] ?? fieldType;
}

function isFieldFilled(field: FormFieldElement): boolean {
  if (typeof field.value === "boolean") return field.value;
  if (Array.isArray(field.value)) return field.value.length > 0;
  return field.value !== "";
}

// ─── Field Input Components ───────────────────────────────────────────────────

interface FieldInputProps {
  field: FormFieldElement;
  editedValue: string | boolean | string[];
  onChange: (fieldName: string, value: string | boolean | string[]) => void;
}

function FieldInput({ field, editedValue, onChange }: FieldInputProps) {
  const { fieldType, fieldName, options, properties } = field;
  const isReadOnly = properties.readOnly;

  if (fieldType === "text") {
    const textValue = typeof editedValue === "string" ? editedValue : "";
    if (properties.multiline) {
      return (
        <textarea
          value={textValue}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            onChange(fieldName, e.target.value)
          }
          disabled={isReadOnly}
          maxLength={properties.maxLength ?? undefined}
          rows={3}
          className={cn(
            "w-full resize-none rounded-md border border-input bg-background px-2 py-1.5",
            "text-xs text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          placeholder={`Enter ${fieldName}...`}
        />
      );
    }
    return (
      <input
        type="text"
        value={textValue}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(fieldName, e.target.value)
        }
        disabled={isReadOnly}
        maxLength={properties.maxLength ?? undefined}
        className={cn(
          "w-full rounded-md border border-input bg-background px-2 py-1",
          "text-xs text-foreground placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        placeholder={`Enter ${fieldName}...`}
      />
    );
  }

  if (fieldType === "checkbox") {
    const boolValue = typeof editedValue === "boolean" ? editedValue : false;
    return (
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={boolValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(fieldName, e.target.checked)
          }
          disabled={isReadOnly}
          className="h-3.5 w-3.5 rounded border-input accent-primary disabled:cursor-not-allowed"
        />
        <span className="text-xs text-muted-foreground">
          {boolValue ? "Checked" : "Unchecked"}
        </span>
      </label>
    );
  }

  if (fieldType === "radio") {
    const stringValue = typeof editedValue === "string" ? editedValue : "";
    const radioOptions = options ?? [];
    if (radioOptions.length === 0) {
      return (
        <span className="text-xs text-muted-foreground italic">
          No options defined
        </span>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        {radioOptions.map((option) => (
          <label
            key={option}
            className="flex items-center gap-2 cursor-pointer select-none"
          >
            <input
              type="radio"
              name={fieldName}
              value={option}
              checked={stringValue === option}
              onChange={() => onChange(fieldName, option)}
              disabled={isReadOnly}
              className="h-3 w-3 border-input accent-primary disabled:cursor-not-allowed"
            />
            <span className="text-xs truncate" title={option}>
              {option}
            </span>
          </label>
        ))}
      </div>
    );
  }

  if (fieldType === "dropdown" || fieldType === "listbox") {
    const currentOptions = options ?? [];
    const arrayValue = Array.isArray(editedValue) ? editedValue : [];
    const stringValue = typeof editedValue === "string" ? editedValue : (arrayValue[0] ?? "");

    if (currentOptions.length === 0) {
      return (
        <span className="text-xs text-muted-foreground italic">
          No options defined
        </span>
      );
    }

    return (
      <select
        value={stringValue}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          onChange(fieldName, e.target.value)
        }
        disabled={isReadOnly}
        className={cn(
          "w-full rounded-md border border-input bg-background px-2 py-1",
          "text-xs text-foreground",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <option value="">— Select —</option>
        {currentOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  // signature / button — display-only
  return (
    <span className="text-xs text-muted-foreground italic">
      {fieldType === "signature" ? "Signature field (read-only)" : "Button field"}
    </span>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FormFieldElement;
  editedValue: string | boolean | string[];
  onChange: (fieldName: string, value: string | boolean | string[]) => void;
}

function FieldRow({ field, editedValue, onChange }: FieldRowProps) {
  const [expanded, setExpanded] = useState(true);
  const Icon = getFieldIcon(field.fieldType);
  const filled = isFieldFilled(field);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 w-full px-2.5 py-2 text-left",
          "hover:bg-accent transition-colors",
          "text-xs font-medium",
        )}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />

        <span className="flex-1 truncate" title={field.fieldName}>
          {field.fieldName}
        </span>

        <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
          {getFieldTypeLabel(field.fieldType)}
        </span>

        <span
          className={cn(
            "flex-shrink-0 h-2 w-2 rounded-full",
            filled ? "bg-emerald-500" : "bg-muted-foreground/30",
          )}
          title={filled ? "Filled" : "Empty"}
        />

        {expanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-border bg-background/50">
          {field.properties.readOnly && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-1.5">
              Read-only field
            </p>
          )}
          <FieldInput field={field} editedValue={editedValue} onChange={onChange} />
          {field.properties.maxLength !== null && field.fieldType === "text" && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Max {field.properties.maxLength} characters
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * FormsPanel — sidebar panel to view and fill PDF form fields.
 */
export function FormsPanel({ currentFile, onPdfUpdated }: FormsPanelProps) {
  const [formData, setFormData] = useState<FormFieldsResult | null>(null);
  const [editedValues, setEditedValues] = useState<
    Record<string, string | boolean | string[]>
  >({});
  const [panelExpanded, setPanelExpanded] = useState(true);
  const [fillError, setFillError] = useState<string | null>(null);
  const [fillSuccess, setFillSuccess] = useState(false);

  const getFields = useGetFormFields();
  const fillFields = useFillFormFields();

  const handleLoadFields = useCallback(async () => {
    if (!currentFile) return;

    setFormData(null);
    setEditedValues({});
    setFillError(null);
    setFillSuccess(false);

    try {
      const result = await getFields.mutateAsync(currentFile);
      setFormData(result);

      // Seed edited values from current field values
      const initial: Record<string, string | boolean | string[]> = {};
      for (const field of result.fields) {
        initial[field.fieldName] = field.value;
      }
      setEditedValues(initial);
    } catch (err) {
      // error surfaced via getFields.error
    }
  }, [currentFile, getFields]);

  const handleFieldChange = useCallback(
    (fieldName: string, value: string | boolean | string[]) => {
      setEditedValues((prev) => ({ ...prev, [fieldName]: value }));
      setFillSuccess(false);
    },
    [],
  );

  const handleFillAll = useCallback(async () => {
    if (!currentFile || !formData) return;

    setFillError(null);
    setFillSuccess(false);

    // Only send values for editable fields
    const fillable: Record<string, string | boolean | string[]> = {};
    for (const field of formData.fields) {
      if (
        !field.properties.readOnly &&
        field.fieldType !== "button" &&
        field.fieldType !== "signature"
      ) {
        fillable[field.fieldName] = editedValues[field.fieldName] ?? field.value;
      }
    }

    try {
      const blob = await fillFields.mutateAsync({
        file: currentFile,
        values: fillable,
      });

      setFillSuccess(true);
      onPdfUpdated?.(blob);

      // Offer download as a fallback if no onPdfUpdated provided
      if (!onPdfUpdated) {
        const filename =
          currentFile instanceof File
            ? currentFile.name.replace(/\.pdf$/i, "_filled.pdf")
            : "filled.pdf";
        downloadBlob(blob, filename);
      }
    } catch (err) {
      setFillError(
        err instanceof Error ? err.message : "Failed to fill form fields.",
      );
    }
  }, [currentFile, formData, editedValues, fillFields, onPdfUpdated]);

  // Derived stats
  const totalFields = formData?.totalFields ?? 0;
  const filledCount = formData
    ? formData.fields.filter((f) =>
        isFieldFilled({
          ...f,
          value: editedValues[f.fieldName] ?? f.value,
        } as FormFieldElement),
      ).length
    : 0;

  const editableFields = formData
    ? formData.fields.filter(
        (f) =>
          !f.properties.readOnly &&
          f.fieldType !== "button" &&
          f.fieldType !== "signature",
      )
    : [];

  const isLoading = getFields.isPending;
  const loadError = getFields.error;
  const isFilling = fillFields.isPending;

  return (
    <div className="border-b">
      {/* Panel header */}
      <button
        onClick={() => setPanelExpanded(!panelExpanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span>Form Fields</span>
          {formData !== null && (
            <span className="text-xs text-muted-foreground">
              ({filledCount}/{totalFields})
            </span>
          )}
        </div>
        {panelExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {panelExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Load button */}
          <button
            onClick={handleLoadFields}
            disabled={!currentFile || isLoading}
            className={cn(
              "flex items-center justify-center gap-2 w-full rounded-md px-3 py-1.5",
              "text-xs font-medium border border-input bg-background",
              "hover:bg-accent hover:border-accent-foreground/20 transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scanning fields…
              </>
            ) : (
              <>
                <ScanSearch className="h-3.5 w-3.5" />
                {formData ? "Reload Fields" : "Load Fields"}
              </>
            )}
          </button>

          {/* Load error */}
          {loadError !== null && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {loadError instanceof Error
                  ? loadError.message
                  : "Failed to load form fields."}
              </span>
            </div>
          )}

          {/* No file state */}
          {!currentFile && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Open a PDF file to view its form fields.
            </p>
          )}

          {/* Empty state after scan */}
          {formData !== null && formData.fields.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No form fields found in this PDF.
            </p>
          )}

          {/* Stats bar */}
          {formData !== null && formData.fields.length > 0 && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-2">
              <span>
                <span className="font-semibold text-foreground">{totalFields}</span> field
                {totalFields !== 1 ? "s" : ""}
              </span>
              <span className="text-border">·</span>
              <span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {filledCount}
                </span>{" "}
                filled
              </span>
              <span className="text-border">·</span>
              <span>
                <span className="font-semibold text-foreground">
                  {totalFields - filledCount}
                </span>{" "}
                empty
              </span>
            </div>
          )}

          {/* Field list */}
          {formData !== null && formData.fields.length > 0 && (
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-0.5">
              {formData.fields.map((field) => (
                <FieldRow
                  key={field.fieldName}
                  field={field}
                  editedValue={editedValues[field.fieldName] ?? field.value}
                  onChange={handleFieldChange}
                />
              ))}
            </div>
          )}

          {/* Fill success message */}
          {fillSuccess && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckSquare className="h-3.5 w-3.5 flex-shrink-0" />
              <span>Fields filled successfully.</span>
            </div>
          )}

          {/* Fill error */}
          {fillError !== null && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>{fillError}</span>
            </div>
          )}

          {/* Fill All button */}
          {formData !== null && editableFields.length > 0 && (
            <button
              onClick={handleFillAll}
              disabled={isFilling || !currentFile}
              className={cn(
                "flex items-center justify-center gap-2 w-full rounded-md px-3 py-1.5",
                "text-xs font-medium bg-primary text-primary-foreground",
                "hover:bg-primary/90 transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {isFilling ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Applying…
                </>
              ) : (
                <>
                  <Wand2 className="h-3.5 w-3.5" />
                  Fill All ({editableFields.length})
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
