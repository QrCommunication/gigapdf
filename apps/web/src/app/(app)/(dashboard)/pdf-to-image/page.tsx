"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-image — Render every page of a PDF as images (ZIP of PNGs).
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function PdfToImagePage() {
  return <ToolPageShell toolKey="pdf-to-image" />;
}
