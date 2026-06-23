"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /extract-pages — Extract a selection of pages into a new PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner; the
 * `extract-pages` config + its `tools.extractPages` i18n namespace already
 * exist, so this page only wires them together (no bespoke component).
 */
export default function ExtractPagesPdfPage() {
  return <ToolPageShell toolKey="extract-pages" />;
}
