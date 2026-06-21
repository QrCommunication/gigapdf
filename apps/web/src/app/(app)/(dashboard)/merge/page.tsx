"use client";

import { UniversalMergeTool } from "@/components/dashboard/universal-merge-tool";

/**
 * /merge — Universal Merge tool page.
 *
 * Auth + locale (cookie) are handled by the parent (app)/(dashboard) layout,
 * which wraps this subtree in <AuthGuard> and runs force-dynamic. The page is a
 * thin shell around the client organism that owns the merge workflow.
 */
export default function UniversalMergePage() {
  return <UniversalMergeTool />;
}
