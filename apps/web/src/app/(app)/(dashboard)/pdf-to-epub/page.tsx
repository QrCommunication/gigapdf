"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-epub — Convert a PDF to a reflowable EPUB (.epub) e-book. Uploads the
 * file for a session id, then exports via /api/office/export. Auth + locale
 * (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToEpubPage() {
  return <ToolPageShell toolKey="pdf-to-epub" />;
}
