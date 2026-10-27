/**
 * The OCR dialogs and the tools-page `lang` select must always send a script
 * token, and a distinct one per writing system: the engine maps each token to
 * its own recognizer (covered in packages/pdf-engine/__tests__/
 * ocr-engine-models.test.ts). The former tables sent Cyrillic as "alpha" and
 * Hebrew as "arabic"; `lang` was ignored for searchable/editable output.
 */
import { describe, expect, it } from "vitest";

import { SCRIPT_CHOICES, SCRIPTS_FOR_CHOICE, scriptsFromLanguageCodes } from "../ocr-scripts";

describe("SCRIPT_CHOICES", () => {
  it("sends a distinct script token for every writing system", () => {
    const tokens = SCRIPT_CHOICES.map((choice) => choice.scripts.join("+"));

    expect(new Set(tokens).size).toBe(SCRIPT_CHOICES.length);
  });

  it("no longer reads Cyrillic, Hebrew or traditional Chinese with another script's model", () => {
    expect(SCRIPTS_FOR_CHOICE.cyrillic).toEqual(["cyrillic"]);
    expect(SCRIPTS_FOR_CHOICE.hebrew).toEqual(["hebrew"]);
    expect(SCRIPTS_FOR_CHOICE.chinese_traditional).toEqual(["chinese_traditional"]);
  });
});

describe("scriptsFromLanguageCodes", () => {
  it("maps the tools-page default and every Latin-script option to Latin", () => {
    for (const lang of ["fra+eng", "fra", "eng", "deu", "spa", "ita"]) {
      expect(scriptsFromLanguageCodes(lang)).toEqual(["alpha"]);
    }
  });

  it("keeps the non-Latin script of a mixed request", () => {
    expect(scriptsFromLanguageCodes("rus+eng")).toEqual(["cyrillic", "alpha"]);
    expect(scriptsFromLanguageCodes("heb")).toEqual(["hebrew"]);
  });
});
