"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /image-to-pdf — Combine images into a single PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function ImageToPdfPage() {
  return <ToolPageShell toolKey="image-to-pdf" />;
}
