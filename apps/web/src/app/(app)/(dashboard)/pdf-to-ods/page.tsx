"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-ods — Convert a PDF to an OpenDocument Spreadsheet (.ods) file.
 * Uploads the file for a session id, then exports via /api/office/export. Auth +
 * locale (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToOdsPage() {
  return <ToolPageShell toolKey="pdf-to-ods" />;
}
