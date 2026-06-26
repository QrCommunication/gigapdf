/**
 * formatting-toolbar.test.tsx
 *
 * Covers the SL2 extension AND the body-edit non-regression:
 *
 *   1. NON-REGRESSION — with a body text selection and no header/footer context,
 *      the text-formatting cluster renders and Bold still routes a `fontWeight`
 *      patch through `onElementStyleChange` exactly as before.
 *   2. With `headerFooterContext`, the contextual cluster (insert image, the
 *      four {{token}} buttons, close zone) is appended.
 *   3. The toolbar renders nothing when there is neither a selection nor a
 *      header/footer context.
 *   4. Token buttons are disabled until a text item is focused.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { TextElement } from "@giga-pdf/types";

// Lightweight next-intl mock: every key resolves to its own path, so titles
// (e.g. "bold", "insertImage") are directly queryable.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  FormattingToolbar,
  type HeaderFooterToolbarContext,
} from "../formatting-toolbar";

afterEach(cleanup);

const bodyTextEl = {
  elementId: "body-1",
  type: "text",
  style: {
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    color: "#000000",
    lineHeight: 1.16,
  },
} as unknown as TextElement;

function hfContext(
  over: Partial<HeaderFooterToolbarContext> = {},
): HeaderFooterToolbarContext {
  return {
    onInsertImage: vi.fn(),
    onInsertToken: vi.fn(),
    onCloseZone: vi.fn(),
    canInsertToken: true,
    ...over,
  };
}

describe("FormattingToolbar — body edit (non-regression)", () => {
  it("renders the text cluster and Bold routes a fontWeight patch", () => {
    const onElementStyleChange = vi.fn();
    render(
      <FormattingToolbar
        selectedTextElements={[bodyTextEl]}
        onElementStyleChange={onElementStyleChange}
      />,
    );
    fireEvent.click(screen.getByTitle("bold"));
    expect(onElementStyleChange).toHaveBeenCalledWith("body-1", {
      fontWeight: "bold",
    });
    // No header/footer cluster without context.
    expect(screen.queryByTitle("insertImage")).toBeNull();
  });

  it("renders nothing with no selection and no H/F context", () => {
    const { container } = render(
      <FormattingToolbar
        selectedTextElements={[]}
        onElementStyleChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FormattingToolbar — header/footer context (SL2)", () => {
  it("appends insert-image, token buttons and close-zone", () => {
    const ctx = hfContext();
    render(
      <FormattingToolbar
        selectedTextElements={[]}
        onElementStyleChange={vi.fn()}
        headerFooterContext={ctx}
      />,
    );
    fireEvent.click(screen.getByTitle("insertImage"));
    expect(ctx.onInsertImage).toHaveBeenCalled();

    fireEvent.click(screen.getByText("{{page}}"));
    expect(ctx.onInsertToken).toHaveBeenCalledWith("page");

    fireEvent.click(screen.getByTitle("closeZone"));
    expect(ctx.onCloseZone).toHaveBeenCalled();
  });

  it("disables token buttons until a text item is focused", () => {
    const ctx = hfContext({ canInsertToken: false });
    render(
      <FormattingToolbar
        selectedTextElements={[]}
        onElementStyleChange={vi.fn()}
        headerFooterContext={ctx}
      />,
    );
    const pageToken = screen.getByText("{{pages}}");
    expect(pageToken).toBeDisabled();
    fireEvent.click(pageToken);
    expect(ctx.onInsertToken).not.toHaveBeenCalled();
  });
});
