"use client";

/**
 * page-chrome.tsx
 *
 * Presentational Word-like page frame for the continuous editor view: a white
 * sheet with a drop shadow, an active-state ring, and a page-number badge.
 * Purely visual — it sizes itself to `width`/`height` (CSS px) and renders its
 * children (the page canvas host) inside. No state, no side effects.
 */

import React from "react";

export interface PageChromeProps {
  /** Rendered page width in CSS pixels (page points × zoom). */
  width: number;
  /** Rendered page height in CSS pixels (page points × zoom). */
  height: number;
  /** 1-based page number shown in the badge. */
  pageNumber: number;
  /** Whether this page is the active/focused one (draws a highlight ring). */
  active?: boolean;
  /** The page canvas host (or any overlay) rendered inside the sheet. */
  children?: React.ReactNode;
}

/**
 * White page sheet with shadow + page-number badge. The sheet is sized exactly
 * to the rendered page; children are absolutely positioned to fill it.
 */
export function PageChrome({
  width,
  height,
  pageNumber,
  active = false,
  children,
}: PageChromeProps) {
  return (
    <div
      className="relative mx-auto bg-white shadow-lg transition-shadow"
      style={{
        width,
        height,
        // Active page gets an accent ring; inactive a subtle hairline border.
        outline: active ? "2px solid var(--color-primary, #6366f1)" : "1px solid #e5e7eb",
        outlineOffset: active ? "-1px" : "0",
      }}
      data-page-number={pageNumber}
      data-active={active ? "true" : "false"}
      aria-label={`Page ${pageNumber}`}
    >
      {children}

      {/* Page-number badge, anchored just below the sheet's bottom-right. */}
      <span
        className="pointer-events-none absolute -bottom-6 right-0 select-none text-xs text-gray-400"
        aria-hidden="true"
      >
        {pageNumber}
      </span>
    </div>
  );
}
