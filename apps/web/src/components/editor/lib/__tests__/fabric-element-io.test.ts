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
import { fabricObjectToElement, readFormFieldValue } from "../fabric-element-io";

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

describe("fabricObjectToElement — cosmetic scaleX neutralisation", () => {
  it("ignores a cosmetic scaleX for the text bounds.width", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Long overflowing label",
      left: 5,
      top: 30,
      width: 200,
      scaleX: 0.4, // cosmetic squeeze
      data: {
        elementId: "t1",
        type: "text",
        cosmeticScaleX: true,
        originalFont: "Helvetica",
      },
    });
    const el = fabricObjectToElement(obj);
    expect(el!.type).toBe("text");
    // bounds.width = width * 1 (cosmetic scaleX neutralised), NOT 200 * 0.4 = 80.
    expect(el!.bounds.width).toBe(200);
  });

  it("still honours a REAL scaleX (user resize) for the bounds.width", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Resized",
      width: 100,
      scaleX: 1.5,
      data: {
        elementId: "t2",
        type: "text",
        cosmeticScaleX: false,
        originalFont: "Helvetica",
      },
    });
    const el = fabricObjectToElement(obj);
    expect(el!.bounds.width).toBe(150);
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
