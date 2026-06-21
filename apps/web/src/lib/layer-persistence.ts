/**
 * Pure helpers for cross-session layer persistence (P2b frontend).
 *
 * The editor keeps two things that must survive a reload:
 *  - `userLayers`: editor-only "Layer Groups" (NOT PDF OCG layers)
 *  - element→layer membership, keyed by the element's DETERMINISTIC id
 *    (P1: elementId = page,type,index), so membership re-attaches to the
 *    freshly re-parsed elements for unchanged content.
 *
 * These helpers are framework-free (no React) so they can be unit-tested in
 * isolation and reused by the editor page.
 */
import type { LayerObject, PageObject } from "@giga-pdf/types";

/** Membership map: elementId → layerId. */
export type LayerMembership = Record<string, string>;

/**
 * Walk the document pages and build the membership snapshot for every element
 * that currently belongs to a user layer (`layerId != null`).
 *
 * Pure: does not mutate its input.
 */
export function buildMembership(pages: readonly PageObject[]): LayerMembership {
  const membership: LayerMembership = {};
  for (const page of pages) {
    for (const element of page.elements) {
      if (element.layerId != null) {
        membership[element.elementId] = element.layerId;
      }
    }
  }
  return membership;
}

/**
 * Result of merging a saved snapshot against the freshly-parsed pages.
 */
export interface MergeLayersResult {
  /** Layers to restore into the editor's `userLayers` state. */
  layers: LayerObject[];
  /**
   * Pruned membership: only entries whose elementId still exists in the parsed
   * pages AND whose layerId still exists in the restored layers. This is the
   * authoritative membership to apply to the scene graph; entries dropped here
   * reference content that no longer exists (edited/removed) and must NOT be
   * written back blindly.
   */
  membership: LayerMembership;
}

/**
 * Reconcile a saved `{ layers, membership }` snapshot with the current parsed
 * document:
 *  - keep all saved layers (they are the source of truth for grouping);
 *  - prune membership entries whose elementId is absent from the parsed pages,
 *    or whose layerId is absent from the saved layers.
 *
 * Pure: does not mutate inputs.
 */
export function mergeSavedLayers(
  saved: { layers: readonly LayerObject[]; membership: LayerMembership } | null | undefined,
  pages: readonly PageObject[]
): MergeLayersResult {
  const layers = saved?.layers ? [...saved.layers] : [];
  const rawMembership = saved?.membership ?? {};

  const knownElementIds = new Set<string>();
  for (const page of pages) {
    for (const element of page.elements) {
      knownElementIds.add(element.elementId);
    }
  }
  const knownLayerIds = new Set(layers.map((l) => l.layerId));

  const membership: LayerMembership = {};
  for (const [elementId, layerId] of Object.entries(rawMembership)) {
    if (knownElementIds.has(elementId) && knownLayerIds.has(layerId)) {
      membership[elementId] = layerId;
    }
  }

  return { layers, membership };
}
