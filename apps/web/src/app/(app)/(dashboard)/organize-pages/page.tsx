"use client";

import { ToolPageShell } from "@/components/dashboard/tool-page-shell";

/**
 * /organize-pages — Extract the pages you want into a new PDF.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the generic ToolRunner.
 */
export default function OrganizePagesPage() {
  return <ToolPageShell toolKey="extract-pages" />;
}
