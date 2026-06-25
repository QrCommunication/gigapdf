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
  Trash2,
  RefreshCw,
  Code,
  Sigma,
  Plus,
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

/** Field-level JavaScript triggers accepted by the engine (`/AA` actions). */
type FieldScriptTrigger = "keystroke" | "format" | "validate" | "calculate";

const FIELD_SCRIPT_TRIGGERS: readonly FieldScriptTrigger[] = [
  "keystroke",
  "format",
  "validate",
  "calculate",
];

/**
 * POST one operation to `/api/pdf/forms` (multipart/form-data) and return the
 * mutated PDF as a Blob. Throws with the route's JSON `error` message on a
 * non-2xx response so callers can surface it. Same-origin → the session cookie
 * is sent automatically (the route is guarded by `requireSession`).
 */
async function postFormsAction(
  file: File,
  params: Record<string, string>,
): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", file);
  for (const [key, value] of Object.entries(params)) fd.append(key, value);

  const res = await fetch("/api/pdf/forms", { method: "POST", body: fd });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the status-code message.
    }
    throw new Error(message);
  }
  return res.blob();
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
  /** Delete the field from the AcroForm (removeField). */
  onDeleteField: (name: string) => void;
  /** Rebuild the field's appearance stream (regenerateFieldAppearance). */
  onRegenerateField: (name: string) => void;
  /** Attach field-level JavaScript for a trigger (setFieldScript). */
  onAttachScript: (
    name: string,
    trigger: FieldScriptTrigger,
    js: string,
  ) => void;
  /** Disable the document-mutating actions while another op is in flight. */
  actionsDisabled: boolean;
}

function FieldRow({
  field,
  editedValue,
  onChange,
  highlighted,
  onDeleteField,
  onRegenerateField,
  onAttachScript,
  actionsDisabled,
}: FieldRowProps) {
  const t = useTranslations("editor.forms");
  const [expanded, setExpanded] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptTrigger, setScriptTrigger] =
    useState<FieldScriptTrigger>("calculate");
  const [scriptJs, setScriptJs] = useState("");
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

          {/* Per-field document operations (mutate the AcroForm). */}
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => setScriptOpen((open) => !open)}
              disabled={actionsDisabled}
              className="flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] hover:bg-accent transition-colors disabled:opacity-40"
              title={t("attachScript")}
            >
              <Code size={11} />
              {t("attachScript")}
            </button>
            <button
              type="button"
              onClick={() => onRegenerateField(field.fieldName)}
              disabled={actionsDisabled}
              className="flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] hover:bg-accent transition-colors disabled:opacity-40"
              title={t("regenerateAppearance")}
            >
              <RefreshCw size={11} />
              {t("regenerate")}
            </button>
            <button
              type="button"
              onClick={() => onDeleteField(field.fieldName)}
              disabled={actionsDisabled}
              className="flex items-center gap-1 rounded border border-destructive/40 px-1.5 py-1 text-[10px] text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
              title={t("deleteField")}
            >
              <Trash2 size={11} />
              {t("delete")}
            </button>
          </div>

          {scriptOpen && (
            <div className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
              <label className="block text-[10px] font-medium text-muted-foreground">
                {t("scriptTriggerLabel")}
              </label>
              <select
                value={scriptTrigger}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setScriptTrigger(e.target.value as FieldScriptTrigger)
                }
                className="w-full rounded border border-input bg-background px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {FIELD_SCRIPT_TRIGGERS.map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {t(`scriptTriggers.${trigger}`)}
                  </option>
                ))}
              </select>
              <textarea
                value={scriptJs}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setScriptJs(e.target.value)
                }
                rows={3}
                spellCheck={false}
                className="w-full resize-none rounded border border-input bg-background px-1.5 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("scriptPlaceholder")}
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onAttachScript(field.fieldName, scriptTrigger, scriptJs);
                    setScriptOpen(false);
                    setScriptJs("");
                  }}
                  disabled={actionsDisabled || scriptJs.trim().length === 0}
                  className="flex-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {t("applyScript")}
                </button>
                <button
                  type="button"
                  onClick={() => setScriptOpen(false)}
                  className="rounded border px-2 py-1 text-[10px] hover:bg-accent transition-colors"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Advanced field tools (mode Remplir) ──────────────────────────────────────

interface AdvancedFieldToolsProps {
  /** Names of the loaded AcroForm fields (for the calculation-order editor). */
  fieldNames: string[];
  disabled: boolean;
  onAddSignatureField: (
    name: string,
    pageNumber: number,
    rect: [number, number, number, number],
  ) => void;
  onSetCalculationOrder: (names: string[]) => void;
}

/**
 * Document-level field operations that are not tied to a single row:
 *  - Add a (visible) signature field at an explicit page + rect.
 *  - Reorder the AcroForm calculation order (`/CO`).
 *
 * Local state is seeded from `fieldNames`; the parent remounts this component
 * (keyed on the field set) whenever the loaded fields change, so the editable
 * calculation order always starts from the current document.
 */
function AdvancedFieldTools({
  fieldNames,
  disabled,
  onAddSignatureField,
  onSetCalculationOrder,
}: AdvancedFieldToolsProps) {
  const t = useTranslations("editor.forms");
  const [open, setOpen] = useState(false);

  // Add-signature form state.
  const [sigName, setSigName] = useState("");
  const [sigPage, setSigPage] = useState("1");
  const [sigRect, setSigRect] = useState({
    x0: "72",
    y0: "72",
    x1: "252",
    y1: "144",
  });

  // Editable calculation order (seeded from the loaded field set).
  const [calcOrder, setCalcOrder] = useState<string[]>(fieldNames);

  const moveCalc = (index: number, direction: "up" | "down") => {
    setCalcOrder((order) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= order.length) return order;
      const item = order[index];
      if (item === undefined) return order;
      const next = [...order];
      next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const sigNameTrimmed = sigName.trim();
  const sigPageNum = Number(sigPage);
  const rectNums = {
    x0: Number(sigRect.x0),
    y0: Number(sigRect.y0),
    x1: Number(sigRect.x1),
    y1: Number(sigRect.y1),
  };
  const rectValid =
    Object.values(rectNums).every((n) => Number.isFinite(n)) &&
    rectNums.x1 > rectNums.x0 &&
    rectNums.y1 > rectNums.y0;
  const canAddSignature =
    !disabled &&
    sigNameTrimmed.length > 0 &&
    Number.isInteger(sigPageNum) &&
    sigPageNum >= 1 &&
    rectValid;

  return (
    <div className="rounded-md border border-border bg-background/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-xs font-medium hover:bg-accent transition-colors"
      >
        <PenLine className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">{t("advancedTitle")}</span>
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-2.5 py-2.5">
          {/* Add signature field */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-foreground">
              {t("addSignatureTitle")}
            </p>
            <input
              type="text"
              value={sigName}
              onChange={(e) => setSigName(e.target.value)}
              placeholder={t("signatureNamePlaceholder")}
              className="w-full rounded border border-input bg-background px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-muted-foreground">
                {t("pageLabel")}
              </label>
              <input
                type="number"
                min={1}
                value={sigPage}
                onChange={(e) => setSigPage(e.target.value)}
                className="w-14 rounded border border-input bg-background px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(["x0", "y0", "x1", "y1"] as const).map((key) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <label className="text-[9px] uppercase text-muted-foreground">
                    {key}
                  </label>
                  <input
                    type="number"
                    value={sigRect[key]}
                    onChange={(e) =>
                      setSigRect((r) => ({ ...r, [key]: e.target.value }))
                    }
                    className="w-full rounded border border-input bg-background px-1 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground">
              {t("rectHint")}
            </p>
            <button
              type="button"
              onClick={() =>
                onAddSignatureField(sigNameTrimmed, sigPageNum, [
                  rectNums.x0,
                  rectNums.y0,
                  rectNums.x1,
                  rectNums.y1,
                ])
              }
              disabled={!canAddSignature}
              className="flex w-full items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              <Plus size={11} />
              {t("addSignatureField")}
            </button>
          </div>

          {/* Calculation order */}
          <div className="space-y-1.5 border-t border-border/60 pt-2">
            <p className="flex items-center gap-1 text-[11px] font-medium text-foreground">
              <Sigma size={11} />
              {t("calcOrderTitle")}
            </p>
            {calcOrder.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
                {t("calcOrderEmpty")}
              </p>
            ) : (
              <>
                <p className="text-[9px] text-muted-foreground">
                  {t("calcOrderHint")}
                </p>
                <div className="space-y-1">
                  {calcOrder.map((name, index) => (
                    <div
                      key={name}
                      className="flex items-center gap-1.5 rounded border border-border px-1.5 py-1"
                    >
                      <span className="w-4 text-right text-[10px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <span
                        className="flex-1 truncate text-[11px]"
                        title={name}
                      >
                        {name}
                      </span>
                      <button
                        type="button"
                        onClick={() => moveCalc(index, "up")}
                        disabled={index === 0}
                        aria-label={t("moveUp")}
                        className="flex h-5 w-5 items-center justify-center rounded border hover:bg-accent transition-colors disabled:opacity-40"
                      >
                        <ArrowUp size={10} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCalc(index, "down")}
                        disabled={index >= calcOrder.length - 1}
                        aria-label={t("moveDown")}
                        className="flex h-5 w-5 items-center justify-center rounded border hover:bg-accent transition-colors disabled:opacity-40"
                      >
                        <ArrowDown size={10} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onSetCalculationOrder(calcOrder)}
                  disabled={disabled}
                  className="w-full rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {t("applyCalcOrder")}
                </button>
              </>
            )}
          </div>
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
  // Advanced field operations (add signature / scripts / calc order / delete /
  // regenerate) call /api/pdf/forms directly and share one busy/feedback state.
  const [advBusy, setAdvBusy] = useState(false);
  const [advError, setAdvError] = useState<string | null>(null);
  const [advSuccess, setAdvSuccess] = useState<string | null>(null);

  // Synchronous mirror of the current PDF: each mutation returns a new blob and
  // the parent updates `currentFile` asynchronously, so back-to-back ops must
  // chain off the freshest bytes (mirrors the editor's currentPdfFileRef rule).
  const latestFileRef = useRef<File | null>(currentFile);
  useEffect(() => {
    latestFileRef.current = currentFile;
  }, [currentFile]);

  const getFields = useGetFormFields();
  const fillFields = useFillFormFields();
  const flattenPdf = useFlattenPdf();

  const loadFieldsFrom = useCallback(
    async (file: File) => {
      setFormData(null);
      setEditedValues({});
      setFillError(null);
      setFillSuccess(false);

      try {
        const result = await getFields.mutateAsync(file);
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
    },
    [getFields, onFieldsLoaded],
  );

  const handleLoadFields = useCallback(() => {
    if (!currentFile) return;
    return loadFieldsFrom(currentFile);
  }, [currentFile, loadFieldsFrom]);

  /**
   * Run one AcroForm field operation against /api/pdf/forms, push the mutated
   * PDF up to the parent, and reload the field list from the new bytes so the
   * panel reflects the change. Errors surface in `advError`.
   */
  const runDocOp = useCallback(
    async (params: Record<string, string>, successMsg: string) => {
      const file = latestFileRef.current;
      if (!file) return;

      setAdvBusy(true);
      setAdvError(null);
      setAdvSuccess(null);
      try {
        const blob = await postFormsAction(file, params);
        const next = new File([blob], file.name, { type: "application/pdf" });
        // Update the ref synchronously so a follow-up op chains off these bytes.
        latestFileRef.current = next;
        onPdfUpdated?.(blob);
        await loadFieldsFrom(next);
        setAdvSuccess(successMsg);
      } catch (err) {
        setAdvError(err instanceof Error ? err.message : t("actionFailed"));
      } finally {
        setAdvBusy(false);
      }
    },
    [onPdfUpdated, loadFieldsFrom, t],
  );

  const handleDeleteField = useCallback(
    (name: string) =>
      runDocOp(
        { action: "removeField", name },
        t("deleteSuccess", { field: name }),
      ),
    [runDocOp, t],
  );

  const handleRegenerateField = useCallback(
    (name: string) =>
      runDocOp(
        { action: "regenerateFieldAppearance", name },
        t("regenerateSuccess", { field: name }),
      ),
    [runDocOp, t],
  );

  const handleAttachScript = useCallback(
    (name: string, trigger: FieldScriptTrigger, js: string) =>
      runDocOp(
        { action: "setFieldScript", name, trigger, js },
        t("scriptSuccess", { field: name }),
      ),
    [runDocOp, t],
  );

  const handleAddSignatureField = useCallback(
    (name: string, pageNumber: number, rect: [number, number, number, number]) =>
      runDocOp(
        {
          action: "addSignatureField",
          name,
          pageNumber: String(pageNumber),
          rect: JSON.stringify(rect),
        },
        t("signatureFieldSuccess", { field: name }),
      ),
    [runDocOp, t],
  );

  const handleSetCalculationOrder = useCallback(
    (names: string[]) =>
      runDocOp(
        { action: "setCalculationOrder", names: JSON.stringify(names) },
        t("calcOrderSuccess"),
      ),
    [runDocOp, t],
  );

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
                    onDeleteField={handleDeleteField}
                    onRegenerateField={handleRegenerateField}
                    onAttachScript={handleAttachScript}
                    actionsDisabled={advBusy}
                  />
                ))}
              </div>
            )}

            {/* Advanced field operations (add signature / scripts / calc order) */}
            {currentFile && formData !== null && (
              <AdvancedFieldTools
                key={formData.fields.map((f) => f.fieldName).join("|")}
                fieldNames={formData.fields.map((f) => f.fieldName)}
                disabled={advBusy}
                onAddSignatureField={handleAddSignatureField}
                onSetCalculationOrder={handleSetCalculationOrder}
              />
            )}

            {/* Advanced op feedback */}
            {advBusy && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                <span>{t("applying")}</span>
              </div>
            )}
            {advError !== null && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>{advError}</span>
              </div>
            )}
            {advSuccess !== null && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckSquare className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{advSuccess}</span>
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
