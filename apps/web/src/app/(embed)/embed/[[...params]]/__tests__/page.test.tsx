import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getLocaleMock = vi.fn<() => Promise<string>>();
const getMessagesMock = vi.fn<(opts: { locale: string }) => Promise<unknown>>();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
  getMessages: (opts: { locale: string }) => getMessagesMock(opts),
}));

vi.mock("next-intl", () => ({
  hasLocale: (locales: readonly string[], value: unknown) =>
    typeof value === "string" && locales.includes(value),
  NextIntlClientProvider: function NextIntlClientProvider() {
    return null;
  },
}));

vi.mock("../embed-editor", () => ({
  EmbedEditor: function EmbedEditor() {
    return null;
  },
}));

const { default: EmbedPage } = await import("../page");
const { EmbedEditor } = await import("../embed-editor");

async function renderWith(query: Record<string, string>): Promise<ReactElement> {
  const element = await EmbedPage({ searchParams: Promise.resolve(query) });
  if (!isValidElement(element)) throw new Error("EmbedPage did not return an element");
  return element;
}

interface LangWrapperProps {
  lang: string;
  className: string;
  children: ReactElement;
}

/** Asserts `element` is the `<div lang>` wrapper around the editor and returns its lang. */
function langOfEditorWrapper(element: ReactElement): string {
  expect(element.type).toBe("div");
  const props = element.props as LangWrapperProps;
  expect(props.className).toBe("contents");
  expect(props.children.type).toBe(EmbedEditor);
  return props.lang;
}

describe("EmbedPage locale selection", () => {
  beforeEach(() => {
    getLocaleMock.mockResolvedValue("fr");
    getMessagesMock.mockResolvedValue({ embed: { done: "Done" } });
  });

  it("wraps the editor in a provider for the locale requested by the SDK", async () => {
    const element = await renderWith({ token: "t", locale: "en" });
    const props = element.props as {
      locale: string;
      messages: unknown;
      children: ReactElement;
    };

    expect(props.locale).toBe("en");
    expect(props.messages).toEqual({ embed: { done: "Done" } });
    expect(getMessagesMock).toHaveBeenCalledWith({ locale: "en" });
    expect(langOfEditorWrapper(props.children)).toBe("en");
  });

  it("keeps the request locale when the SDK sends no locale", async () => {
    const element = await renderWith({ token: "t" });

    expect(langOfEditorWrapper(element)).toBe("fr");
    expect(getMessagesMock).not.toHaveBeenCalled();
  });

  it("ignores an unsupported locale", async () => {
    const element = await renderWith({ token: "t", locale: "de" });

    expect(langOfEditorWrapper(element)).toBe("fr");
    expect(getMessagesMock).not.toHaveBeenCalled();
  });

  it("does not add a provider when the SDK locale matches the request locale", async () => {
    const element = await renderWith({ token: "t", locale: "fr" });

    expect(langOfEditorWrapper(element)).toBe("fr");
    expect(getMessagesMock).not.toHaveBeenCalled();
  });
});
