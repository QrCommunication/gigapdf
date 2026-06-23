/**
 * Client-side PII detection over the parsed scene graph.
 *
 * The engine's `redactPii` redacts *given* regions — it is not a detector, and
 * the editor already has a manual redaction tool (draw zones → `redactDocument`,
 * see `redact-pii.ts`). This module adds the auto-detect layer: it scans the
 * already-parsed text elements (no extra parse) for common PII patterns (email,
 * phone, IBAN, credit card, French SSN/SIREN) and returns the matching text
 * elements as `WebRedactionRect`s, ready to flow through the SAME baking path as
 * the manual tool (`groupRectsByPage` + `redactDocument`).
 *
 * Granularity: a text element is redacted as a whole when its content matches.
 * Per-character sub-rects would need glyph-width measurement the scene graph does
 * not carry; covering the full run is the safe direction for redaction
 * (over-covering is harmless, under-covering leaks PII). Coordinates stay in WEB
 * space (top-left origin) — `webRectToPdf` lowers them at bake time.
 */

import type { PageObject, Element, TextElement } from "@giga-pdf/types";
import type { WebRedactionRect } from "./redact-pii";

export type PiiKind = "email" | "phone" | "iban" | "creditCard" | "ssn" | "siren";

export interface PiiMatch {
  /** 1-based page number. */
  pageNumber: number;
  /** WEB-space rectangle of the matched text element. */
  rect: WebRedactionRect;
  /** Category of the matched pattern. */
  kind: PiiKind;
  /** The matched substring (for the confirmation list). */
  text: string;
}

interface PatternSpec {
  kind: PiiKind;
  regex: RegExp;
  /** Minimum digit count to accept the match (false-positive guard). */
  minDigits?: number;
}

// Patterns are intentionally conservative to limit false positives. `g` flag so
// `String.match` walks every occurrence in a run. Order matters: the most
// SPECIFIC patterns (email, IBAN, card, SSN) are tried before the permissive
// phone pattern, so a long digit run carrying a country prefix is classified as
// IBAN rather than swallowed as a phone number. The whole run is redacted either
// way — ordering only affects the displayed category.
const PII_PATTERNS: PatternSpec[] = [
  {
    kind: "email",
    regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  },
  {
    // IBAN: 2 letters + 2 check digits + up to 30 alphanumerics.
    kind: "iban",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  },
  {
    // Credit card: 13-16 digits, optionally grouped by spaces/dashes in 4s.
    kind: "creditCard",
    regex: /\b(?:\d[ -]?){13,16}\b/g,
    minDigits: 13,
  },
  {
    // French INSEE / social-security number: 15 digits (often spaced).
    kind: "ssn",
    regex: /\b[12]\d{2}(?:\s?\d{2}){6}\b/g,
    minDigits: 13,
  },
  {
    // French SIREN/SIRET: 9 or 14 digits, often spaced in groups of 3.
    kind: "siren",
    regex: /\b\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?\b/g,
    minDigits: 9,
  },
  {
    // International / French phone numbers: optional +, grouped digits with
    // common separators. Guarded by a 9-digit floor to avoid matching prices.
    // Last (most permissive) so specific numeric IDs win their category.
    kind: "phone",
    regex: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){3,5}\d{2,4}/g,
    minDigits: 9,
  },
];

/** Digit-count guard for the numeric patterns. */
function hasEnoughDigits(value: string, min: number): boolean {
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 48 && c <= 57) count++;
    if (count >= min) return true;
  }
  return false;
}

function isTextElement(el: Element): el is TextElement {
  return el.type === "text";
}

/**
 * Scan one page's text elements for PII. A text element contributes at most one
 * match (its bounds), tagged with the first pattern that hits — the whole run is
 * redacted regardless, so multiple hits in the same run collapse to one region.
 */
function detectOnPage(page: PageObject): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const el of page.elements) {
    if (!isTextElement(el)) continue;
    const content = el.content;
    if (!content || content.length < 4) continue;

    for (const { kind, regex, minDigits } of PII_PATTERNS) {
      // Reset lastIndex: shared regex objects are stateful with the `g` flag.
      regex.lastIndex = 0;
      const found = content.match(regex);
      if (!found || found.length === 0) continue;
      const hit = minDigits ? found.find((m) => hasEnoughDigits(m, minDigits)) : found[0];
      if (!hit) continue;
      matches.push({
        pageNumber: page.pageNumber,
        rect: {
          x: el.bounds.x,
          y: el.bounds.y,
          width: el.bounds.width,
          height: el.bounds.height,
          pageNumber: page.pageNumber,
        },
        kind,
        text: hit.trim(),
      });
      break; // one region per run
    }
  }
  return matches;
}

/** Detect PII across all pages of the parsed document. */
export function detectPii(pages: PageObject[]): PiiMatch[] {
  const all: PiiMatch[] = [];
  for (const page of pages) {
    all.push(...detectOnPage(page));
  }
  return all;
}

/** Reduce matches to the `WebRedactionRect[]` consumed by `groupRectsByPage`. */
export function matchesToRects(matches: PiiMatch[]): WebRedactionRect[] {
  return matches.map((m) => m.rect);
}
