"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
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
  PencilRuler,
  ClipboardEdit,
  ArrowUp,
  ArrowDown,
  Layers,
} from "lucide-react";
import {
  useGetFormFields,
  useFillFormFields,
  useFlattenPdf,
  downloadBlob,
} from "@giga-pdf/api";
import type { FormFieldsResult } from "@giga-pdf/api";
import type { FormFieldElement, FieldType } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FormsPanelMode = "design" | "fill";

/**
 * Champ extrait du PDF par /api/pdf/forms (action=get) : FormFieldElement
 * enrichi du numéro de page (1-indexé) renvoyé par le moteur — requis pour
 * surligner le champ sur le canvas de la bonne page.
 */
export type LoadedFormField = FormFieldElement & { pageNumber?: number };

export interface FormsPanelProps {
  currentFile: File | null;
  onPdfUpdated?: (blob: Blob) => void;
  /** Mode contrôlé par le parent : design = placer/éditer, fill = remplir. */
  mode: FormsPanelMode;
  onModeChange: (mode: FormsPanelMode) => void;
  /**
   * Champs PDF existants chargés (mode Remplir) — remontés au parent pour
   * l'overlay de surlignage sur le canvas.
   */
  onFieldsLoaded?: (fields: LoadedFormField[]) => void;
  /** Champ ciblé depuis l'overlay canvas (scroll + mise en évidence). */
  focusedFieldName?: string | null;
  /**
   * Mode Concevoir : champs du document (scene graph, toutes pages) dans
   * l'ordre de bake. Cet ordre EST l'ordre de création des champs AcroForm
   * au save — soit l'ordre de tabulation dans la plupart des lecteurs PDF
   * (pas de /Tabs explicite : limitation moteur documentée).
   */
  designFields?: Array<{ element: FormFieldElement; pageIndex: number }>;
  /** Sélection d'un champ design dans la liste (navigue + sélectionne). */
  onDesignFieldSelect?: (elementId: string, pageIndex: number) => void;
  /** Réordonnancement d'un champ design (monte/descend dans l'ordre de bake). */
  onDesignFieldReorder?: (elementId: string, direction: "up" | "down") => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Icône du type de champ, retournée comme NŒUD JSX (et non comme référence
 * de composant assignée pendant le render — react-hooks/static-components).
 */
function getFieldIconNode(
  fieldType: FieldType,
  className: string,
): React.ReactNode {
  switch (fieldType) {
    case "text":
      return <Type className={className} />;
    case "checkbox":
      return <CheckSquare className={className} />;
    case "radio":
      return <Radio className={className} />;
    case "dropdown":
    case "listbox":
      return <List className={className} />;
    case "signature":
      return <PenLine className={className} />;
    default:
      return <FileText className={className} />;
  }
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
  const t = useTranslations("editor.forms");
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
          placeholder={t("enterValue", { field: fieldName })}
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
        placeholder={t("enterValue", { field: fieldName })}
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
          {boolValue ? t("checked") : t("unchecked")}
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
          {t("noOptionsDefined")}
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
    const stringValue =
      typeof editedValue === "string" ? editedValue : (arrayValue[0] ?? "");

    if (currentOptions.length === 0) {
      return (
        <span className="text-xs text-muted-foreground italic">
          {t("noOptionsDefined")}
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
        <option value="">{t("selectOption")}</option>
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
      {fieldType === "signature" ? t("signatureReadOnly") : t("buttonField")}
    </span>
  );
}

// ─── Field Row (mode Remplir) ─────────────────────────────────────────────────

interface FieldRowProps {
  field: FormFieldElement;
  editedValue: string | boolean | string[];
  onChange: (fieldName: string, value: string | boolean | string[]) => void;
  highlighted: boolean;
}

function FieldRow({ field, editedValue, onChange, highlighted }: FieldRowProps) {
  const t = useTranslations("editor.forms");
  const [expanded, setExpanded] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);
  const filled = isFieldFilled(field);
  // Dérivé (pas de setState dans l'effet) : un champ ciblé depuis l'overlay
  // canvas est toujours déplié pour que sa saisie soit immédiatement visible.
  const isExpanded = expanded || highlighted;

  // Champ ciblé depuis l'overlay canvas → scroll dans la liste (effet DOM pur).
  useEffect(() => {
    if (!highlighted) return;
    rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);

  return (
    <div
      ref={rowRef}
      className={cn(
        "border rounded-md overflow-hidden transition-colors",
        highlighted ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <button
        onClick={() => setExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 w-full px-2.5 py-2 text-left",
          "hover:bg-accent transition-colors",
          "text-xs font-medium",
        )}
      >
        {getFieldIconNode(
          field.fieldType,
          "h-3.5 w-3.5 flex-shrink-0 text-muted-foreground",
        )}

        <span className="flex-1 truncate" title={field.fieldName}>
          {field.fieldName}
          {field.properties.required ? (
            <span className="text-destructive ml-0.5">*</span>
          ) : null}
        </span>

        <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
          {t(`fieldTypes.${field.fieldType}`)}
        </span>

        <span
          className={cn(
            "flex-shrink-0 h-2 w-2 rounded-full",
            filled ? "bg-emerald-500" : "bg-muted-foreground/30",
          )}
          title={filled ? t("filled") : t("empty")}
        />

        {isExpanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-border bg-background/50">
          {field.properties.readOnly && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-1.5">
              {t("readOnlyField")}
            </p>
          )}
          <FieldInput field={field} editedValue={editedValue} onChange={onChange} />
          {field.properties.maxLength !== null && field.fieldType === "text" && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("maxChars", { count: field.properties.maxLength })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * FormsPanel — panneau latéral de gestion des formulaires PDF.
 *
 * Deux modes :
 *  - Concevoir : liste des champs du document (scene graph) avec sélection
 *    et réordonnancement (l'ordre de liste = ordre de bake AcroForm = ordre
 *    de tabulation logique dans la plupart des lecteurs).
 *  - Remplir : extrait les champs EXISTANTS du PDF, saisie des valeurs,
 *    application via /api/pdf/forms (action=fill), option d'aplatissement.
 */
export function FormsPanel({
  currentFile,
  onPdfUpdated,
  mode,
  onModeChange,
  onFieldsLoaded,
  focusedFieldName = null,
  designFields = [],
  onDesignFieldSelect,
  onDesignFieldReorder,
}: FormsPanelProps) {
  const t = useTranslations("editor.forms");
  const [formData, setFormData] = useState<FormFieldsResult | null>(null);
  const [editedValues, setEditedValues] = useState<
    Record<string, string | boolean | string[]>
  >({});
  const [fillError, setFillError] = useState<string | null>(null);
  const [fillSuccess, setFillSuccess] = useState(false);
  const [flattenAfterFill, setFlattenAfterFill] = useState(false);

  const getFields = useGetFormFields();
  const fillFields = useFillFormFields();
  const flattenPdf = useFlattenPdf();

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
      // Remonte les champs (avec bounds + pageNumber) au parent pour
      // l'overlay de surlignage sur le canvas.
      onFieldsLoaded?.(result.fields as LoadedFormField[]);
    } catch {
      // error surfaced via getFields.error
    }
  }, [currentFile, getFields, onFieldsLoaded]);

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
      let blob: Blob = await fillFields.mutateAsync({
        file: currentFile,
        values: fillable,
      });

      // Option « Aplatir après remplissage » : les widgets deviennent du
      // contenu de page définitif (non modifiable) — utile pour archivage.
      if (flattenAfterFill) {
        const file = new File([blob], currentFile.name, {
          type: "application/pdf",
        });
        blob = await flattenPdf.mutateAsync({ file });
      }

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
      setFillError(err instanceof Error ? err.message : t("fillFailed"));
    }
  }, [
    currentFile,
    formData,
    editedValues,
    fillFields,
    flattenAfterFill,
    flattenPdf,
    onPdfUpdated,
    t,
  ]);

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
  const isFilling = fillFields.isPending || flattenPdf.isPending;

  return (
    <div className="w-72 border-l bg-muted/30 flex flex-col h-full overflow-hidden">
      {/* Header + bascule de mode */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" />
          <span>{t("title")}</span>
          {mode === "fill" && formData !== null && (
            <span className="text-xs text-muted-foreground">
              ({filledCount}/{totalFields})
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
          <button
            type="button"
            onClick={() => onModeChange("design")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
              mode === "design"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <PencilRuler className="h-3.5 w-3.5" />
            {t("modeDesign")}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("fill")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
              mode === "fill"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ClipboardEdit className="h-3.5 w-3.5" />
            {t("modeFill")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {mode === "design" ? (
          <>
            <p className="text-[11px] text-muted-foreground">
              {t("designHint")}
            </p>
            {designFields.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {t("noDesignFields")}
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground">
                  {t("tabOrderHint")}
                </p>
                {designFields.map(({ element, pageIndex }, index) => {
                  return (
                    <div
                      key={element.elementId}
                      className="flex items-center gap-1.5 border border-border rounded-md px-2 py-1.5 bg-background/50"
                    >
                      <span className="text-[10px] text-muted-foreground w-4 text-right">
                        {index + 1}
                      </span>
                      {getFieldIconNode(
                        element.fieldType,
                        "h-3.5 w-3.5 flex-shrink-0 text-muted-foreground",
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onDesignFieldSelect?.(element.elementId, pageIndex)
                        }
                        className="flex-1 min-w-0 text-left text-xs truncate hover:text-primary transition-colors"
                        title={element.fieldName}
                      >
                        {element.fieldName}
                      </button>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {t("pageShort", { page: pageIndex + 1 })}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onDesignFieldReorder?.(element.elementId, "up")
                        }
                        disabled={index === 0}
                        title={t("moveUp")}
                        aria-label={t("moveUp")}
                        className="h-6 w-5 flex items-center justify-center rounded border hover:bg-accent transition-colors disabled:opacity-40"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onDesignFieldReorder?.(element.elementId, "down")
                        }
                        disabled={index >= designFields.length - 1}
                        title={t("moveDown")}
                        aria-label={t("moveDown")}
                        className="h-6 w-5 flex items-center justify-center rounded border hover:bg-accent transition-colors disabled:opacity-40"
                      >
                        <ArrowDown size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
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
                  {t("scanning")}
                </>
              ) : (
                <>
                  <ScanSearch className="h-3.5 w-3.5" />
                  {formData ? t("reloadFields") : t("loadFields")}
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
                    : t("loadFailed")}
                </span>
              </div>
            )}

            {/* No file state */}
            {!currentFile && (
              <p className="text-xs text-muted-foreground text-center py-2">
                {t("openPdfFirst")}
              </p>
            )}

            {/* Empty state after scan */}
            {formData !== null && formData.fields.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                {t("noFieldsFound")}
              </p>
            )}

            {/* Stats bar */}
            {formData !== null && formData.fields.length > 0 && (
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-2">
                <span>
                  <span className="font-semibold text-foreground">
                    {totalFields}
                  </span>{" "}
                  {t("fieldsCount", { count: totalFields })}
                </span>
                <span className="text-border">·</span>
                <span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {filledCount}
                  </span>{" "}
                  {t("filledCount")}
                </span>
                <span className="text-border">·</span>
                <span>
                  <span className="font-semibold text-foreground">
                    {totalFields - filledCount}
                  </span>{" "}
                  {t("emptyCount")}
                </span>
              </div>
            )}

            {/* Field list */}
            {formData !== null && formData.fields.length > 0 && (
              <div className="space-y-1.5">
                {formData.fields.map((field) => (
                  <FieldRow
                    key={field.fieldName}
                    field={field}
                    editedValue={editedValues[field.fieldName] ?? field.value}
                    onChange={handleFieldChange}
                    highlighted={focusedFieldName === field.fieldName}
                  />
                ))}
              </div>
            )}

            {/* Fill success message */}
            {fillSuccess && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckSquare className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{t("fillSuccess")}</span>
              </div>
            )}

            {/* Fill error */}
            {fillError !== null && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>{fillError}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer mode Remplir : option aplatir + bouton appliquer */}
      {mode === "fill" && formData !== null && editableFields.length > 0 && (
        <div className="border-t p-3 space-y-2 bg-background/50">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={flattenAfterFill}
              onChange={(e) => setFlattenAfterFill(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {t("flattenAfterFill")}
            </span>
          </label>
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
                {t("applying")}
              </>
            ) : (
              <>
                <Wand2 className="h-3.5 w-3.5" />
                {t("fillAll", { count: editableFields.length })}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
