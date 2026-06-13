"use client";

import { useTranslations } from "next-intl";
import type { LoadedFormField } from "./forms-panel";

export interface FormFillOverlayProps {
  /** Champs extraits du PDF (toutes pages, pageNumber 1-indexé). */
  fields: LoadedFormField[];
  /** Index 0-based de la page affichée. */
  currentPageIndex: number;
  /** Zoom courant — les bounds sont en points PDF, l'overlay en pixels écran. */
  zoom: number;
  /** Champ actuellement ciblé (synchronisé avec le FormsPanel). */
  focusedFieldName: string | null;
  /** Clic sur un champ → focus de la ligne correspondante dans le panel. */
  onFieldClick: (fieldName: string) => void;
}

/**
 * Surlignage cliquable des champs de formulaire EXISTANTS du PDF (mode
 * Remplir). Rendu via la prop `overlay` d'EditorCanvas, donc positionné dans
 * le repère page×zoom et défilant avec la page. Le parent (page.tsx) filtre
 * l'affichage au mode Remplir actif.
 */
export function FormFillOverlay({
  fields,
  currentPageIndex,
  zoom,
  focusedFieldName,
  onFieldClick,
}: FormFillOverlayProps) {
  const t = useTranslations("editor.forms");
  const pageFields = fields.filter(
    (field) => (field.pageNumber ?? 1) - 1 === currentPageIndex,
  );

  if (pageFields.length === 0) return null;

  return (
    <>
      {pageFields.map((field) => {
        const isFocused = focusedFieldName === field.fieldName;
        return (
          <button
            key={`${field.fieldName}-${field.bounds.x}-${field.bounds.y}`}
            type="button"
            onClick={() => onFieldClick(field.fieldName)}
            title={t("highlightTooltip", { field: field.fieldName })}
            aria-label={t("highlightTooltip", { field: field.fieldName })}
            // pointer-events réactivés ici : le conteneur overlay
            // d'EditorCanvas est pointer-events-none pour laisser passer
            // les interactions canvas entre les champs.
            className={`absolute pointer-events-auto rounded-sm border-2 transition-colors ${
              isFocused
                ? "border-primary bg-primary/20"
                : "border-blue-400/70 bg-blue-300/15 hover:bg-blue-300/30"
            }`}
            style={{
              left: field.bounds.x * zoom,
              top: field.bounds.y * zoom,
              width: Math.max(6, field.bounds.width * zoom),
              height: Math.max(6, field.bounds.height * zoom),
            }}
          />
        );
      })}
    </>
  );
}
