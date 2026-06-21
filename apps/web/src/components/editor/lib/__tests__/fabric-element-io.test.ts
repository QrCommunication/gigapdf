/**
 * fabric-element-io.test.ts
 *
 * Round-trip guards for `fabricObjectToElement` — the inverse of the overlay
 * renderer. Two behaviours are critical and easy to regress:
 *
 *   1. An editable text FORM FIELD is rendered as an IText (Fabric `type` =
 *      "i-text"). It MUST serialise back as `type:"form_field"` (never as free
 *      `type:"text"`), or the field identity (fieldType/fieldName/options) is
 *      lost and the AcroForm is never reconstructed at bake time.
 *   2. The typed value / checked state must be re-read from the live object so
 *      user input is persisted.
 *   3. A COSMETIC scaleX (anti-overflow fit on the fallback font) must NOT bleed
 *      into bounds.width, which would corrupt the redaction/replaceText region.
 */

import { describe, it, expect } from "vitest";
import type { FabricObjectWithData } from "../fabric-element-io";
import {
  fabricObjectToElement,
  fabricObjectToElements,
  readFormFieldValue,
} from "../fabric-element-io";
import type { TextElement } from "@giga-pdf/types";

/** Minimal Fabric-like object stub carrying our `.data` metadata. */
function fabricStub(
  partial: Partial<FabricObjectWithData> & { type?: string; text?: string },
): FabricObjectWithData {
  return {
    left: 0,
    top: 0,
    width: 100,
    height: 16,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    skewX: 0,
    skewY: 0,
    selectable: true,
    visible: true,
    ...partial,
  } as unknown as FabricObjectWithData;
}

function textFieldElement(value: string): Record<string, unknown> {
  return {
    type: "form_field",
    elementId: "f1",
    fieldType: "text",
    fieldName: "lastName",
    value,
    defaultValue: "",
    options: null,
    properties: {
      required: false,
      readOnly: false,
      maxLength: null,
      multiline: false,
      password: false,
      comb: false,
    },
    style: {
      fontFamily: "Helvetica",
      fontSize: 11,
      textColor: "#0a3a8a",
      backgroundColor: null,
      borderColor: null,
      borderWidth: 0,
    },
    format: { type: "none", pattern: null },
    placeholder: "Last name",
    bounds: { x: 10, y: 20, width: 120, height: 16 },
    visible: true,
    locked: false,
  };
}

describe("fabricObjectToElement — form field round-trip", () => {
  it("serialises a text-field IText as form_field, NOT free text", () => {
    const field = textFieldElement("");
    const obj = fabricStub({
      type: "i-text",
      text: "Dupont",
      left: 10,
      top: 20,
      width: 120,
      data: {
        elementId: "f1",
        type: "form_field",
        fieldType: "text",
        fieldName: "lastName",
        fieldPlaceholder: "Last name",
        formFieldElement: field as never,
      },
    });
    const el = fabricObjectToElement(obj);
    expect(el).not.toBeNull();
    expect(el!.type).toBe("form_field");
    // Field identity preserved.
    const ff = el as unknown as {
      fieldType: string;
      fieldName: string;
      value: unknown;
    };
    expect(ff.fieldType).toBe("text");
    expect(ff.fieldName).toBe("lastName");
    // Typed value persisted.
    expect(ff.value).toBe("Dupont");
  });

  it("persists '' (not the placeholder) for an empty text field", () => {
    const field = textFieldElement("");
    const obj = fabricStub({
      type: "i-text",
      text: "Last name", // still showing the placeholder
      data: {
        elementId: "f1",
        type: "form_field",
        fieldType: "text",
        fieldName: "lastName",
        fieldPlaceholder: "Last name",
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as { value: unknown };
    expect(ff.value).toBe("");
  });

  it("reads the checked state of a checkbox field", () => {
    const field = {
      ...textFieldElement(""),
      fieldType: "checkbox",
      fieldName: "agree",
      value: false,
    };
    const obj = fabricStub({
      type: "i-text",
      text: "☑",
      data: {
        elementId: "cb",
        type: "form_field",
        fieldType: "checkbox",
        fieldName: "agree",
        fieldChecked: true,
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as {
      type: string;
      value: unknown;
    };
    expect(ff.type).toBe("form_field");
    expect(ff.value).toBe(true);
  });

  it("reads the selected option of a checked radio field", () => {
    const field = {
      ...textFieldElement(""),
      fieldType: "radio",
      fieldName: "answer",
      options: ["yes"],
      value: "",
    };
    const obj = fabricStub({
      type: "i-text",
      text: "◉",
      data: {
        elementId: "r-yes",
        type: "form_field",
        fieldType: "radio",
        fieldName: "answer",
        fieldChecked: true,
        fieldExportValue: "yes",
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as { value: unknown };
    expect(ff.value).toBe("yes");
  });

  it("serialises an unchecked radio back to '' (group has one value)", () => {
    const field = {
      ...textFieldElement(""),
      fieldType: "radio",
      fieldName: "answer",
      options: ["no"],
      value: "no",
    };
    const obj = fabricStub({
      type: "i-text",
      text: "○",
      data: {
        elementId: "r-no",
        type: "form_field",
        fieldType: "radio",
        fieldName: "answer",
        fieldChecked: false,
        fieldExportValue: "no",
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as { value: unknown };
    expect(ff.value).toBe("");
  });
});

describe("fabricObjectToElement — scaleX is taken verbatim (no cosmetic fit)", () => {
  it("bakes a user-resize scaleX into bounds.width", () => {
    // The cosmetic anti-overflow scaleX no longer exists (render-elements stopped
    // squashing text). scaleX is therefore always a real user resize and is baked
    // straight into bounds.width.
    const obj = fabricStub({
      type: "i-text",
      text: "Resized",
      width: 100,
      scaleX: 1.5,
      data: {
        elementId: "t2",
        type: "text",
        originalFont: "Helvetica",
      },
    });
    const el = fabricObjectToElement(obj);
    expect(el!.type).toBe("text");
    expect(el!.bounds.width).toBe(150);
  });

  it("uses scaleX=1 (no squeeze) verbatim when the object was not resized", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Natural width",
      width: 200,
      scaleX: 1,
      data: { elementId: "t1", type: "text", originalFont: "Helvetica" },
    });
    const el = fabricObjectToElement(obj);
    expect(el!.bounds.width).toBe(200);
  });
});

describe("readFormFieldValue", () => {
  const base = textFieldElement("") as unknown as Parameters<
    typeof readFormFieldValue
  >[1];

  it("returns boolean for checkbox from data.fieldChecked", () => {
    const field = { ...base, fieldType: "checkbox" as const };
    expect(
      readFormFieldValue(
        fabricStub({ data: { fieldChecked: true } }),
        field,
      ),
    ).toBe(true);
    expect(
      readFormFieldValue(
        fabricStub({ data: { fieldChecked: false } }),
        field,
      ),
    ).toBe(false);
  });

  it("returns the typed text for a text field, ignoring the placeholder", () => {
    const field = { ...base, fieldType: "text" as const };
    expect(
      readFormFieldValue(
        fabricStub({ text: "hello", data: { fieldPlaceholder: "name" } }),
        field,
      ),
    ).toBe("hello");
    expect(
      readFormFieldValue(
        fabricStub({ text: "name", data: { fieldPlaceholder: "name" } }),
        field,
      ),
    ).toBe("");
  });

  it("keeps the stored value for non-keyboard fields (signature)", () => {
    const field = {
      ...base,
      fieldType: "signature" as const,
      value: "kept",
    };
    expect(readFormFieldValue(fabricStub({}), field)).toBe("kept");
  });
});

// --- Paragraph Textbox decomposition (multi-line save) -----------------------

/** Stub a coalesced paragraph Textbox carrying its source runs on data. */
function paragraphTextbox(
  text: string,
  runs: Array<{
    elementId: string;
    index?: number;
    x: number;
    y: number;
    width: number;
    height?: number;
    content: string;
  }>,
  over: Partial<FabricObjectWithData> = {},
): FabricObjectWithData {
  const originLeft = Math.min(...runs.map((r) => r.x));
  const originTop = Math.min(...runs.map((r) => r.y));
  return fabricStub({
    type: "textbox",
    text,
    left: originLeft,
    top: originTop,
    width: Math.max(...runs.map((r) => r.x + r.width)) - originLeft,
    fontSize: 12,
    fontFamily: "Helvetica",
    fill: "#000000",
    lineHeight: 1.2,
    textAlign: "left",
    data: {
      elementId: runs[0]!.elementId,
      type: "text",
      isParagraph: true,
      originalFont: "ABCDEF+Body",
      paragraphRuns: runs.map((r) => ({
        elementId: r.elementId,
        ...(r.index !== undefined ? { index: r.index } : {}),
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height ?? 12 },
        content: r.content,
      })),
    },
    ...over,
  } as unknown as Partial<FabricObjectWithData> & { type?: string; text?: string });
}

describe("fabricObjectToElements — paragraph decomposition", () => {
  it("passes a non-paragraph object straight through (1 element)", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Hello",
      data: { elementId: "t1", type: "text", originalFont: "Helvetica" },
    });
    const els = fabricObjectToElements(obj);
    expect(els).toHaveLength(1);
    expect(els[0]!.type).toBe("text");
    expect((els[0] as TextElement).content).toBe("Hello");
  });

  it("returns [] for an unknown object type", () => {
    const obj = fabricStub({ type: "group", data: {} });
    expect(fabricObjectToElements(obj)).toEqual([]);
  });

  it("decomposes an UNCHANGED paragraph into its runs, preserving indices", () => {
    const obj = paragraphTextbox("Line A\nLine B\nLine C", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
      { elementId: "c", index: 7, x: 40, y: 128, width: 300, content: "Line C" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els).toHaveLength(3);
    expect(els.map((e) => e.elementId)).toEqual(["a", "b", "c"]);
    expect(els.map((e) => e.index)).toEqual([5, 6, 7]); // lossless replaceText
    expect(els.map((e) => e.content)).toEqual(["Line A", "Line B", "Line C"]);
    // bounds.y inherited from the source runs (block not moved).
    expect(els.map((e) => e.bounds.y)).toEqual([100, 114, 128]);
  });

  it("maps an EDITED middle line onto its source run (index kept)", () => {
    const obj = paragraphTextbox("Line A\nEDITED\nLine C", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
      { elementId: "c", index: 7, x: 40, y: 128, width: 300, content: "Line C" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els[1]!.content).toBe("EDITED");
    expect(els[1]!.elementId).toBe("b");
    expect(els[1]!.index).toBe(6);
  });

  it("translates every run when the whole block was MOVED", () => {
    const obj = paragraphTextbox("Line A\nLine B", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    // Move the block: origin was (40,100); set it to (90,160) → dx=50, dy=60.
    (obj as { left?: number; top?: number }).left = 90;
    (obj as { left?: number; top?: number }).top = 160;
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els.map((e) => e.bounds.x)).toEqual([90, 90]);
    expect(els.map((e) => e.bounds.y)).toEqual([160, 174]);
    // Indices preserved (a move is still an in-place edit of the same runs).
    expect(els.map((e) => e.index)).toEqual([5, 6]);
  });

  it("ADDS a new run (no index) when a line is appended", () => {
    const obj = paragraphTextbox("Line A\nLine B\nNEW LINE", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els).toHaveLength(3);
    expect(els[2]!.content).toBe("NEW LINE");
    // The appended line has NO engine index → takes the add path.
    expect(els[2]!.index).toBeUndefined();
    // It is stacked under the last source line (y > previous line's y).
    expect(els[2]!.bounds.y).toBeGreaterThan(els[1]!.bounds.y);
  });

  it("ERASES a removed line (surplus run serialised with empty content)", () => {
    const obj = paragraphTextbox("Line A", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els).toHaveLength(2);
    expect(els[0]!.content).toBe("Line A");
    // The deleted line's source run is kept with "" so replaceText erases it.
    expect(els[1]!.elementId).toBe("b");
    expect(els[1]!.index).toBe(6);
    expect(els[1]!.content).toBe("");
  });

  it("applies the live block colour to every decomposed run", () => {
    const obj = paragraphTextbox("Line A\nLine B", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    (obj as { fill?: string }).fill = "#ff0000"; // user recoloured the block
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els.every((e) => e.style.color === "#ff0000")).toBe(true);
    // originalFont inherited so the bake re-uses the same subset.
    expect(els.every((e) => e.style.originalFont === "ABCDEF+Body")).toBe(true);
  });
});
