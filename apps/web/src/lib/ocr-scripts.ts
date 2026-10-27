/**
 * Writing systems offered by the OCR dialogs (editor + GED) and how they map to
 * the `scripts` tokens sent to `/api/pdf/ocr`. The route forwards the tokens to
 * the engine, which forces the matching recognizer of the gigapdf-ocr service
 * (`scriptTokensToOcrModel` in @giga-pdf/pdf-engine).
 *
 * Each choice maps to its OWN token. The previous tables, written for the old
 * bundled models, sent Cyrillic as Latin ("alpha"), Hebrew as "arabic" and
 * traditional Chinese as simplified ("cjk"), so the service read those scans
 * with the wrong model; it now ships dedicated cyrillic / he / zh_tw models.
 */
export type ScriptChoice =
  | "latin"
  | "cyrillic"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "tamil"
  | "telugu"
  | "kannada"
  | "chinese_simplified"
  | "chinese_traditional"
  | "japanese"
  | "korean";

export const SCRIPT_CHOICES: readonly { value: ScriptChoice; scripts: string[] }[] = [
  { value: "latin", scripts: ["alpha"] },
  { value: "cyrillic", scripts: ["cyrillic"] },
  { value: "arabic", scripts: ["arabic"] },
  { value: "hebrew", scripts: ["hebrew"] },
  { value: "devanagari", scripts: ["devanagari"] },
  { value: "tamil", scripts: ["tamil"] },
  { value: "telugu", scripts: ["telugu"] },
  { value: "kannada", scripts: ["kannada"] },
  { value: "chinese_simplified", scripts: ["chinese_simplified"] },
  { value: "chinese_traditional", scripts: ["chinese_traditional"] },
  { value: "japanese", scripts: ["japanese"] },
  { value: "korean", scripts: ["korean"] },
];

export const SCRIPTS_FOR_CHOICE: Record<ScriptChoice, string[]> = Object.fromEntries(
  SCRIPT_CHOICES.map((choice) => [choice.value, choice.scripts]),
) as Record<ScriptChoice, string[]>;

/** ISO 639-2 codes whose script is not Latin; every other code reads as Latin. */
const NON_LATIN_LANGUAGE_SCRIPTS: Record<string, string> = {
  rus: "cyrillic",
  ukr: "cyrillic",
  bel: "cyrillic",
  bul: "cyrillic",
  srp: "cyrillic",
  mkd: "cyrillic",
  ara: "arabic",
  fas: "arabic",
  urd: "arabic",
  heb: "hebrew",
  hin: "devanagari",
  mar: "devanagari",
  nep: "devanagari",
  tam: "tamil",
  tel: "telugu",
  kan: "kannada",
  chi_sim: "chinese_simplified",
  chi_tra: "chinese_traditional",
  jpn: "japanese",
  kor: "korean",
};

/**
 * `scripts` tokens for a `lang` hint such as "fra+eng" (the tools-page OCR
 * select). Without this, the searchable/editable modes ignored `lang` and the
 * service auto-selected a model per line: on a French invoice it picked the
 * Hebrew recognizer (garbage text) after ~80 s, versus 10 s and correct text
 * with the Latin model forced.
 */
export function scriptsFromLanguageCodes(lang: string): string[] {
  const scripts = lang
    .split("+")
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code.length > 0)
    .map((code) => NON_LATIN_LANGUAGE_SCRIPTS[code] ?? "alpha");
  return [...new Set(scripts)];
}
