"use client";

import { OrganizePagesTool } from "@/components/dashboard/organize-pages-tool";

/**
 * /organize-pages — Reorder, rotate, and delete the pages of a PDF, then apply
 * the changes in one pass and download the result.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout
 * (AuthGuard + force-dynamic). Thin shell over the interactive client organism
 * that owns the whole organize workflow (its own header + page board).
 */
export default function OrganizePagesPage() {
  return <OrganizePagesTool />;
}
