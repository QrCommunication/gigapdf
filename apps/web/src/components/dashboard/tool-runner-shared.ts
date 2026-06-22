/**
 * Shared request/output helpers for the tool runners.
 *
 * Both the file-based {@link import("./tool-runner").ToolRunner} and the
 * text/URL {@link import("./tool-text-runner").ToolTextRunner} resolve the
 * download filename and serialise option fields the same way; centralising the
 * logic keeps the two runners in lockstep and avoids drift.
 */

import type { ToolConfig, ToolField } from "./tool-runner-types";

/** Ensure a filename carries the expected extension (case-insensitive). */
export function withExtension(name: string, ext: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().endsWith(`.${ext}`) ? trimmed : `${trimmed}.${ext}`;
}

/** Output extension for a non-zip binary response, derived from the endpoint. */
export function extOf(config: ToolConfig): string {
  const guess = config.defaultOutputName.toLowerCase().split(".").pop();
  return guess && guess.length <= 5 ? guess : "pdf";
}

/** Resolve the download filename from user input, output type, and defaults. */
export function resolveOutputName(config: ToolConfig, outputName: string): string {
  const ext = config.responseKind === "splitZip" ? "zip" : extOf(config);
  if (config.allowOutputName) {
    const named = withExtension(outputName, ext);
    if (named) return named;
  }
  return config.defaultOutputName;
}

/**
 * Compute the serialised value of an option field, or `null` when it should be
 * omitted (an empty optional field, so the backend applies its default).
 * `file` fields are never serialised here.
 */
function serializeFieldValue(
  field: ToolField,
  fieldValues: Record<string, string>,
): string | null {
  if (field.type === "file") return null;
  const raw = fieldValues[field.name] ?? "";
  const value = field.serialize ? field.serialize(raw) : raw;
  if (value === "" && !field.required) return null;
  return value;
}

/**
 * In JSON mode, coerce a serialised field value to the JS type the endpoint
 * expects. Switches become real booleans; everything else stays a string
 * (callers that need numbers use a `serialize` that yields a numeric literal).
 */
function jsonFieldValue(field: ToolField, value: string): unknown {
  if (field.type === "switch") return value === "true";
  return value;
}

export interface BuildRequestPayloadArgs {
  config: ToolConfig;
  fieldValues: Record<string, string>;
  /** The already-resolved download filename. */
  outputName: string;
  /** The captured text/URL for text/URL tools (absent for file tools). */
  textValue?: string;
}

export interface RequestPayload {
  body: BodyInit;
  /** Extra request headers (e.g. `Content-Type: application/json`). */
  headers: Record<string, string>;
}

/**
 * Build the request body + headers for a text/URL tool. Supports `json`
 * (the default for these tools) and `formData`. Constants, option fields and
 * the primary text value are all included; the output filename is sent as
 * `outputFilename` (JSON) or `outputName` (FormData) to mirror the existing
 * endpoint contracts.
 */
export function buildRequestPayload({
  config,
  fieldValues,
  outputName,
  textValue,
}: BuildRequestPayloadArgs): RequestPayload {
  const kind = config.request?.kind ?? "formData";
  const valueField = config.input?.valueField;
  const transform = config.input?.transform;
  const wireValue =
    textValue !== undefined && transform ? transform(textValue) : textValue;

  if (kind === "json") {
    const payload: Record<string, unknown> = {};

    for (const constant of config.constants ?? []) {
      payload[constant.name] = constant.value;
    }
    for (const field of config.fields) {
      const value = serializeFieldValue(field, fieldValues);
      if (value === null) continue;
      payload[field.name] = jsonFieldValue(field, value);
    }
    if (valueField && wireValue !== undefined) {
      payload[valueField] = wireValue;
    }
    if (config.allowOutputName) {
      payload.outputFilename = outputName;
    }

    return {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    };
  }

  // Multipart fallback (text value + fields as form fields).
  const form = new FormData();
  for (const constant of config.constants ?? []) {
    form.append(constant.name, constant.value);
  }
  for (const field of config.fields) {
    const value = serializeFieldValue(field, fieldValues);
    if (value === null) continue;
    form.append(field.name, value);
  }
  if (valueField && wireValue !== undefined) {
    form.append(valueField, wireValue);
  }
  if (config.allowOutputName) {
    form.append("outputName", outputName);
  }

  return { body: form, headers: {} };
}
