"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /html-to-pdf — Convert raw HTML (CSS grid/flex, RTL, gradients…) to PDF via
 * the in-house HTML→PDF engine. Auth + locale (cookie) are handled by the
 * parent (app)/(dashboard) layout. Thin shell over the generic ToolRunner.
 */
export default function HtmlToPdfPage() {
  return <ToolPageShell toolKey="html-to-pdf" />;
}
