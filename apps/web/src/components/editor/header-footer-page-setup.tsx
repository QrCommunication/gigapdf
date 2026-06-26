"use client";

/**
 * header-footer-page-setup.tsx
 *
 * The Word-like "page setup" switches for the running header/footer mode (SL3):
 * "Different first page" (`differentFirstPage`) and "Different odd & even pages"
 * (`differentOddEven`). Rendered in the toolbar only while a header/footer zone
 * is being edited. Purely presentational — toggling a switch calls back up; the
 * editor flips the flag AND seeds the matching override zone (`ensureZone`) so
 * the divergent zone starts from the default content.
 */

import { useTranslations } from "next-intl";

export interface HeaderFooterPageSetupProps {
  /** Whether page 1 gets its own `firstPage` zone. */
  differentFirstPage: boolean;
  /** Whether even/odd pages get their own `evenPage`/`oddPage` zones. */
  differentOddEven: boolean;
  /** Toggle "different first page" (the editor seeds the `firstPage` zone). */
  onToggleDifferentFirstPage: () => void;
  /** Toggle "different odd/even" (the editor seeds the `evenPage`/`oddPage` zones). */
  onToggleDifferentOddEven: () => void;
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

function Switch({ label, checked, onToggle }: SwitchProps) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onToggle}
        aria-label={label}
        className="h-3.5 w-3.5 cursor-pointer accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

/** The two running-H/F page-setup switches (first page / odd-even). */
export function HeaderFooterPageSetup({
  differentFirstPage,
  differentOddEven,
  onToggleDifferentFirstPage,
  onToggleDifferentOddEven,
}: HeaderFooterPageSetupProps) {
  const t = useTranslations("editor.headerFooter");
  return (
    <div
      data-testid="hf-page-setup"
      className="flex items-center gap-3 border-l pl-2"
    >
      <Switch
        label={t("differentFirstPage")}
        checked={differentFirstPage}
        onToggle={onToggleDifferentFirstPage}
      />
      <Switch
        label={t("differentOddEven")}
        checked={differentOddEven}
        onToggle={onToggleDifferentOddEven}
      />
    </div>
  );
}
