/**
 * scriptTokensToOcrModel — the writing-system tokens sent by the OCR dialogs
 * must each force their own recognizer of the gigapdf-ocr service. Reading a
 * Cyrillic or Hebrew scan with the Latin or Arabic model returns garbage, and
 * an empty token list lets the service auto-select (slow, and it picked the
 * Hebrew model for French text on the Ploi host, 2026-10-27).
 */
import { describe, expect, it } from 'vitest';

import { scriptTokensToOcrModel } from '../src/ocr-engine';

describe('scriptTokensToOcrModel', () => {
  it.each([
    ['alpha', 'latin'],
    ['cyrillic', 'cyrillic'],
    ['arabic', 'ar'],
    ['hebrew', 'he'],
    ['devanagari', 'devanagari'],
    ['tamil', 'ta'],
    ['telugu', 'te'],
    ['kannada', 'kn'],
    ['chinese_simplified', 'zh'],
    ['chinese_traditional', 'zh_tw'],
    ['japanese', 'ja'],
    ['korean', 'ko'],
  ])('forces the dedicated recognizer for %s', (token, model) => {
    expect(scriptTokensToOcrModel([token])).toBe(model);
  });

  it('prefers a non-Latin script over Latin when both are requested', () => {
    expect(scriptTokensToOcrModel(['alpha', 'cyrillic'])).toBe('cyrillic');
  });

  it('switches Latin to the handwriting recognizer on request', () => {
    expect(scriptTokensToOcrModel(['alpha'], true)).toBe('latin_hw');
  });

  it('leaves the model to auto-selection only when no script is given', () => {
    expect(scriptTokensToOcrModel([])).toBeUndefined();
  });
});
