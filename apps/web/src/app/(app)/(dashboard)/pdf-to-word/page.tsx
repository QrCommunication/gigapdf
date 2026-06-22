"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-word — Convert a PDF to an editable Word (.docx) document. Uploads
 * the file for a session id, then exports via /api/office/export. Auth + locale
 * (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToWordPage() {
  return <ToolPageShell toolKey="pdf-to-word" />;
}
