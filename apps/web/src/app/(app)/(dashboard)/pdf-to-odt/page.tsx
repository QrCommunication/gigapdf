"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-odt — Convert a PDF to an OpenDocument Text (.odt) file. Uploads the
 * file for a session id, then exports via /api/office/export. Auth + locale
 * (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToOdtPage() {
  return <ToolPageShell toolKey="pdf-to-odt" />;
}
