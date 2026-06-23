import { describe, it, expect } from 'vitest';
import type { GigaDocument } from '@qrcommunication/gigapdf-lib';
import { buildSourceIndexAddrMap } from '../../src/model-ops';

// `buildSourceIndexAddrMap` is the flat-index ↔ BlockAddr bridge: it walks the
// unified document model (sections → pages → blocks → runs) and maps every
// run's `source_index` to the `[section, page, index]` address of the
// paragraph/heading block that owns it. Pure & deterministic — no WASM needed.

/** Minimal paragraph block carrying typed-flat runs `{ t:'run', source_index }`. */
function para(sourceIndices: Array<number | null>): unknown {
  return {
    id: 0,
    frame: null,
    rotation: { t: 'd0' },
    kind: {
      t: 'paragraph',
      v: {
        style: {},
        style_ref: null,
        runs: sourceIndices.map((source_index) => ({ t: 'run', source_index })),
      },
    },
  };
}

/** Heading block wrapping a paragraph `{ level, para: { runs } }`. */
function heading(sourceIndices: number[]): unknown {
  return {
    id: 0,
    frame: null,
    rotation: { t: 'd0' },
    kind: {
      t: 'heading',
      v: {
        level: 1,
        para: {
          style: {},
          style_ref: null,
          runs: sourceIndices.map((source_index) => ({ t: 'run', source_index })),
        },
      },
    },
  };
}

/** Image block — carries no addressable runs. */
function imageBlock(): unknown {
  return {
    id: 0,
    frame: null,
    rotation: { t: 'd0' },
    kind: { t: 'image', v: { resource: 0, alt: null } },
  };
}

/** Build a one-section doc from a list of pages (each a list of blocks). */
function doc(pages: unknown[][]): GigaDocument {
  return {
    v: 1,
    meta: { title: null, author: null, subject: null, keywords: [], lang: null },
    styles: null,
    sections: [
      {
        geometry: { width: 612, height: 792, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
        header: null,
        footer: null,
        pages: pages.map((blocks) => ({ blocks, absolute: false })),
      },
    ],
    outline: [],
    resources: null,
  } as unknown as GigaDocument;
}

describe('buildSourceIndexAddrMap', () => {
  it('maps every paragraph run source_index to its [section, page, index] address', () => {
    const model = doc([[para([10, 11]), para([20])]]);
    const map = buildSourceIndexAddrMap(model);

    expect(map.get(10)).toEqual([0, 0, 0]);
    expect(map.get(11)).toEqual([0, 0, 0]);
    expect(map.get(20)).toEqual([0, 0, 1]);
    expect(map.size).toBe(3);
  });

  it('addresses blocks by their position in the page (block index = array index)', () => {
    // image block at index 0 carries no runs, but it still occupies index 0 →
    // the following paragraph must be addressed at index 1, not 0.
    const model = doc([[imageBlock(), para([5])]]);
    const map = buildSourceIndexAddrMap(model);
    expect(map.get(5)).toEqual([0, 0, 1]);
  });

  it('indexes runs inside heading blocks', () => {
    const model = doc([[heading([1, 2])]]);
    const map = buildSourceIndexAddrMap(model);
    expect(map.get(1)).toEqual([0, 0, 0]);
    expect(map.get(2)).toEqual([0, 0, 0]);
  });

  it('uses the per-page block index (page p, section 0)', () => {
    const model = doc([[para([100])], [para([200]), para([201])]]);
    const map = buildSourceIndexAddrMap(model);
    expect(map.get(100)).toEqual([0, 0, 0]);
    expect(map.get(200)).toEqual([0, 1, 0]);
    expect(map.get(201)).toEqual([0, 1, 1]);
  });

  it('skips null / negative source_index (non round-trippable runs)', () => {
    const model = doc([[para([null, -1, 7])]]);
    const map = buildSourceIndexAddrMap(model);
    expect(map.has(7)).toBe(true);
    expect(map.get(7)).toEqual([0, 0, 0]);
    expect(map.size).toBe(1);
  });

  it('reads the runtime-wrapped run shape { t:"run", v:{ source_index } }', () => {
    const wrapped = {
      id: 0,
      frame: null,
      rotation: { t: 'd0' },
      kind: {
        t: 'paragraph',
        v: { style: {}, style_ref: null, runs: [{ t: 'run', v: { source_index: 42 } }] },
      },
    };
    const map = buildSourceIndexAddrMap(doc([[wrapped]]));
    expect(map.get(42)).toEqual([0, 0, 0]);
  });

  it('first writer wins for a duplicated source_index (stable address)', () => {
    const model = doc([[para([9]), para([9])]]);
    const map = buildSourceIndexAddrMap(model);
    expect(map.get(9)).toEqual([0, 0, 0]);
    expect(map.size).toBe(1);
  });

  it('returns an empty map for a document with no paragraphs/headings', () => {
    expect(buildSourceIndexAddrMap(doc([[imageBlock()]])).size).toBe(0);
    expect(buildSourceIndexAddrMap(doc([[]])).size).toBe(0);
  });

  it('tolerates a malformed model without throwing', () => {
    const broken = { sections: null } as unknown as GigaDocument;
    expect(() => buildSourceIndexAddrMap(broken)).not.toThrow();
    expect(buildSourceIndexAddrMap(broken).size).toBe(0);
  });
});
