"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-text — Extract a PDF's text content to a plain UTF-8 .txt file.
 * Uploads the file for a session id, then exports via /api/office/export. Auth +
 * locale (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToTextPage() {
  return <ToolPageShell toolKey="pdf-to-text" />;
}
