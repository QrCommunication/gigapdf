/**
 * Layout Store - Word-like page layout: sections, margins, headers, footers.
 *
 * v1 keeps a single section spanning the whole document, but the model already
 * supports several sections with distinct margins / headers / footers. Margins
 * are resolved per page: an explicit per-page override (keyed by pageId) wins,
 * otherwise the margins of the section that contains the page index apply.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { enableMapSet } from "immer";
import { immer } from "zustand/middleware/immer";
import type { Element } from "@giga-pdf/types";
import type { Margins, HeaderFooterContent, SectionLayout } from "../types";

// Immer needs this opt-in to support Set/Map drafts (pageMargins is a Map).
// Idempotent — safe to call even though other stores already enabled it.
enableMapSet();

/** Default A4-ish margins (~25.4mm = 1in = 72pt) used for the initial section. */
const DEFAULT_MARGINS: Margins = { top: 72, right: 72, bottom: 72, left: 72 };

function emptyBand(): HeaderFooterContent {
  return { enabled: false, elements: [], height: 36, showOnFirstPage: true };
}

/** Build the default single section spanning the whole document. */
function defaultSection(): SectionLayout {
  return {
    margins: { ...DEFAULT_MARGINS },
    header: emptyBand(),
    footer: emptyBand(),
    pageRange: { from: 0, to: Number.MAX_SAFE_INTEGER },
  };
}

export interface LayoutState {
  /** Ordered layout sections. v1: always a single whole-document section. */
  sections: SectionLayout[];
  /** Per-page margin overrides, keyed by pageId. Overrides the section margins. */
  pageMargins: Map<string, Margins>;
  /** The header/footer band currently being edited, if any. */
  editingBand: { pageId: string; band: "header" | "footer" } | null;
}

export interface LayoutStore extends LayoutState {
  /** Set the margins of a section by index. */
  setSectionMargins: (sectionIndex: number, margins: Margins) => void;
  /** Set a per-page margin override (wins over the section margins). */
  setPageMargins: (pageId: string, margins: Margins) => void;
  /**
   * Resolve the effective margins for a page: the per-page override if present,
   * otherwise the margins of the section containing `pageIndex`, otherwise the
   * default margins.
   */
  getEffectiveMargins: (pageId: string, pageIndex: number) => Margins;
  /** Patch the header band of a section. */
  setHeader: (sectionIndex: number, patch: Partial<HeaderFooterContent>) => void;
  /** Patch the footer band of a section. */
  setFooter: (sectionIndex: number, patch: Partial<HeaderFooterContent>) => void;
  /**
   * Append an element to the currently-edited header/footer band, or to the
   * matching band of the first section as a fallback. Also enables the band.
   */
  upsertHeaderFooterElement: (band: "header" | "footer", el: Element) => void;
  /** Begin editing a header/footer band. */
  enterBandEdit: (pageId: string, band: "header" | "footer") => void;
  /** Stop editing the header/footer band. */
  exitBandEdit: () => void;
  reset: () => void;
}

const initialState: LayoutState = {
  sections: [defaultSection()],
  pageMargins: new Map<string, Margins>(),
  editingBand: null,
};

/** Section index containing a page index (-1 if none matches). */
function sectionIndexForPage(sections: SectionLayout[], pageIndex: number): number {
  return sections.findIndex(
    (s) => pageIndex >= s.pageRange.from && pageIndex <= s.pageRange.to
  );
}

export const useLayoutStore: UseBoundStore<StoreApi<LayoutStore>> =
  create<LayoutStore>()(
    immer((set, get) => ({
      ...initialState,

      setSectionMargins: (sectionIndex, margins) =>
        set((state) => {
          const section = state.sections[sectionIndex];
          if (section) {
            section.margins = { ...margins };
          }
        }),

      setPageMargins: (pageId, margins) =>
        set((state) => {
          state.pageMargins.set(pageId, { ...margins });
        }),

      getEffectiveMargins: (pageId, pageIndex) => {
        const state = get();
        const override = state.pageMargins.get(pageId);
        if (override) {
          return override;
        }
        const idx = sectionIndexForPage(state.sections, pageIndex);
        const section = idx >= 0 ? state.sections[idx] : state.sections[0];
        return section ? section.margins : { ...DEFAULT_MARGINS };
      },

      setHeader: (sectionIndex, patch) =>
        set((state) => {
          const section = state.sections[sectionIndex];
          if (section) {
            section.header = { ...section.header, ...patch };
          }
        }),

      setFooter: (sectionIndex, patch) =>
        set((state) => {
          const section = state.sections[sectionIndex];
          if (section) {
            section.footer = { ...section.footer, ...patch };
          }
        }),

      upsertHeaderFooterElement: (band, el) =>
        set((state) => {
          // Target the section of the band being edited; fall back to the
          // first section when no band edit is in progress.
          const editing = state.editingBand;
          const idx =
            editing && editing.band === band
              ? sectionIndexForPage(
                  state.sections,
                  // We only have a pageId in editingBand; the section lookup is
                  // index-based, so fall back to the first section. v1 has a
                  // single section, so this resolves to 0 either way.
                  0
                )
              : 0;
          const section = state.sections[idx >= 0 ? idx : 0];
          if (!section) {
            return;
          }
          const target = band === "header" ? section.header : section.footer;
          target.enabled = true;
          const existing = target.elements.findIndex(
            (e) => e.elementId === el.elementId
          );
          if (existing !== -1) {
            target.elements[existing] = el;
          } else {
            target.elements.push(el);
          }
        }),

      enterBandEdit: (pageId, band) =>
        set((state) => {
          state.editingBand = { pageId, band };
        }),

      exitBandEdit: () =>
        set((state) => {
          state.editingBand = null;
        }),

      // Rebuild fresh references so the reset state never aliases the initial
      // section objects / Map (immer drafts would otherwise share structure).
      reset: () =>
        set(() => ({
          sections: [defaultSection()],
          pageMargins: new Map<string, Margins>(),
          editingBand: null,
        })),
    }))
  );
