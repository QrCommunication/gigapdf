"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-rtf — Convert a PDF to a Rich Text Format (.rtf) document. Uploads the
 * file for a session id, then exports via /api/office/export. Auth + locale
 * (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToRtfPage() {
  return <ToolPageShell toolKey="pdf-to-rtf" />;
}
