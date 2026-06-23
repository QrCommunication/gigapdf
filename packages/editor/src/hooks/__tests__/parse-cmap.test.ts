/**
 * Tests for the pure glyph-coverage (cmap) parser used by useEmbeddedFonts to
 * pick, among several DISJOINT same-family+variant subsets (CERFA), the one that
 * actually covers a run's text.
 *
 * Coverage:
 *  - parseCmapCodepoints: format-4 subset coverage (only mapped codepoints)
 *  - parseCmapCodepoints: returns empty Set on malformed / too-short input
 *  - textCodepoints: dedupes + strips whitespace
 */

import { describe, it, expect } from 'vitest';
import { parseCmapCodepoints, textCodepoints } from '../use-embedded-fonts';

// ─── Minimal sfnt + cmap (format 4) builder ─────────────────────────────────
// Builds the smallest valid font the parser reads: an sfnt table directory with
// a single `cmap` table, whose only subtable is a Windows-BMP (platform 3 /
// encoding 1) format-4 mapping that covers exactly `codepoints`. Each covered
// codepoint becomes its own 1-char segment with idDelta=1 (non-zero glyph), so
// `parseCmapCodepoints` records it; everything else is absent.

function buildFontWithCoverage(codepoints: number[]): ArrayBuffer {
  const cps = [...new Set(codepoints)].sort((a, b) => a - b);
  // Each codepoint = one segment; +1 terminator segment (0xFFFF).
  const segCount = cps.length + 1;
  const segCountX2 = segCount * 2;
  // format(2) reserved-as-length placeholder handled below; layout:
  // u16 format, u16 length, u16 language, u16 segCountX2, u16 searchRange,
  // u16 entrySelector, u16 rangeShift, end[], reservedPad, start[], delta[],
  // range[] (all idRangeOffset = 0 → no glyphIdArray).
  const subtableHeader = 14;
  const subtableLen = subtableHeader + segCountX2 * 4 + 2; // +2 reservedPad
  const cmapHeader = 4; // version + numTables
  const encodingRecord = 8; // platform, encoding, offset
  const cmapTableLen = cmapHeader + encodingRecord + subtableLen;

  const sfntHeader = 12; // sfnt version + numTables + searchRange/entrySel/rangeShift
  const tableRecord = 16; // tag + checksum + offset + length
  const cmapOffset = sfntHeader + tableRecord;
  const total = cmapOffset + cmapTableLen;

  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);

  // sfnt header
  v.setUint32(0, 0x00010000); // version 1.0 (TrueType)
  v.setUint16(4, 1); // numTables
  // (searchRange/entrySelector/rangeShift at 6/8/10 left zero — parser ignores)

  // table record for 'cmap'
  v.setUint32(12, 0x636d6170); // 'cmap'
  v.setUint32(16, 0); // checksum (ignored)
  v.setUint32(20, cmapOffset); // offset
  v.setUint32(24, cmapTableLen); // length

  // cmap header
  v.setUint16(cmapOffset, 0); // version
  v.setUint16(cmapOffset + 2, 1); // numSubtables
  // encoding record: platform 3, encoding 1, subtable offset (relative to cmap)
  const subOffsetRel = cmapHeader + encodingRecord;
  v.setUint16(cmapOffset + 4, 3);
  v.setUint16(cmapOffset + 6, 1);
  v.setUint32(cmapOffset + 8, subOffsetRel);

  const sub = cmapOffset + subOffsetRel;
  v.setUint16(sub, 4); // format
  v.setUint16(sub + 2, subtableLen); // length
  v.setUint16(sub + 4, 0); // language
  v.setUint16(sub + 6, segCountX2);
  // searchRange/entrySelector/rangeShift (8/10/12) — parser ignores them.

  const endBase = sub + 14;
  const startBase = endBase + segCountX2 + 2; // +2 reservedPad
  const deltaBase = startBase + segCountX2;
  const rangeBase = deltaBase + segCountX2;

  cps.forEach((cp, i) => {
    v.setUint16(endBase + i * 2, cp);
    v.setUint16(startBase + i * 2, cp);
    v.setUint16(deltaBase + i * 2, 1); // idDelta=1 → glyph = cp+1 (non-zero)
    v.setUint16(rangeBase + i * 2, 0); // idRangeOffset=0
  });
  // Terminator segment 0xFFFF → 0xFFFF, delta 1, rangeOffset 0.
  const t = cps.length;
  v.setUint16(endBase + t * 2, 0xffff);
  v.setUint16(startBase + t * 2, 0xffff);
  v.setUint16(deltaBase + t * 2, 1);
  v.setUint16(rangeBase + t * 2, 0);

  return buf;
}

describe('parseCmapCodepoints', () => {
  it('records exactly the codepoints a format-4 subset maps', () => {
    // 'D' (0x44) and 'O' (0x4F) only — a CERFA-style disjoint subset.
    const buf = buildFontWithCoverage([0x44, 0x4f]);
    const cov = parseCmapCodepoints(buf);
    expect(cov.has(0x44)).toBe(true); // D
    expect(cov.has(0x4f)).toBe(true); // O
    expect(cov.has(0x53)).toBe(false); // S — not in this subset
    expect(cov.has(0x41)).toBe(false); // A — not in this subset
    // The 0xFFFF terminator must never count as a real glyph.
    expect(cov.has(0xffff)).toBe(false);
  });

  it('lets coverage discriminate which subset covers a title', () => {
    // Two disjoint bold subsets: one only "D", one covering the whole word.
    const onlyD = parseCmapCodepoints(buildFontWithCoverage([0x44]));
    const word = 'DOSSIER';
    const full = parseCmapCodepoints(
      buildFontWithCoverage([...word].map((c) => c.charCodeAt(0))),
    );
    const needed = textCodepoints(word);
    expect(needed.every((cp) => onlyD.has(cp))).toBe(false); // partial → rejected
    expect(needed.every((cp) => full.has(cp))).toBe(true); // full → chosen
  });

  it('returns an empty Set on malformed / too-short input', () => {
    expect(parseCmapCodepoints(new ArrayBuffer(0)).size).toBe(0);
    expect(parseCmapCodepoints(new ArrayBuffer(4)).size).toBe(0);
    // Valid sfnt header but no cmap table.
    const noCmap = new ArrayBuffer(12 + 16);
    const v = new DataView(noCmap);
    v.setUint16(4, 1);
    v.setUint32(12, 0x676c7966); // 'glyf', not 'cmap'
    expect(parseCmapCodepoints(noCmap).size).toBe(0);
  });
});

describe('textCodepoints', () => {
  it('dedupes characters and strips whitespace', () => {
    const cps = textCodepoints('A B  A\nC');
    expect(cps.sort()).toEqual([0x41, 0x42, 0x43]); // A, B, C — space/newline gone, A once
  });

  it('returns empty for whitespace-only text', () => {
    expect(textCodepoints('   \n\t')).toEqual([]);
  });
});
