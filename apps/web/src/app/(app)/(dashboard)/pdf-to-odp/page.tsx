"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-odp — Convert a PDF to an OpenDocument Presentation (.odp) file.
 * Uploads the file for a session id, then exports via /api/office/export. Auth +
 * locale (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToOdpPage() {
  return <ToolPageShell toolKey="pdf-to-odp" />;
}
