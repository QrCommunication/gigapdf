"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /pdf-to-markdown — Convert a PDF to GitHub-flavoured Markdown (.md). Uploads
 * the file for a session id, then exports via /api/office/export. Auth + locale
 * (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function PdfToMarkdownPage() {
  return <ToolPageShell toolKey="pdf-to-markdown" />;
}
