"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /markdown-to-pdf — Convert a Markdown (.md, .markdown) file to PDF. Posts the
 * file to /api/convert/text-format (engine mdToModel → modelToPdf). Auth +
 * locale (cookie) are handled by the parent (app)/(dashboard) layout.
 */
export default function MarkdownToPdfPage() {
  return <ToolPageShell toolKey="markdown-to-pdf" />;
}
