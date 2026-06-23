"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-html — Convert a PDF to a standalone HTML document. Uploads the file
 * for a session id, then exports via /api/office/export. Auth + locale (cookie)
 * are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToHtmlPage() {
  return <ToolPageShell toolKey="pdf-to-html" />;
}
