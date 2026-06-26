/**
 * header-footer-zone.test.tsx
 *
 * The SL2 editable running header/footer bands. These tests verify the editing
 * CONTRACT (the surface page.tsx debounces into a bake):
 *
 *   1. the two bands render (header pinned top, footer pinned bottom);
 *   2. "add text" appends an empty text item to the band and emits a new def
 *      (the change page.tsx turns into a bake) + reports focus;
 *   3. typing into a text item emits an updated def (bake trigger);
 *   4. a pre-seeded image item renders + its delete removes it (new def);
 *   5. focusing a text item reports the focused item up to drive the toolbar.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { HeaderFooterZone } from "../header-footer-zone";
import {
  emptyRunningHeaderFooter,
  appendItemToDefault,
  appendItemToZone,
  makeImageItem,
  makeTextItem,
  HFImageRegistry,
  type RunningHeaderFooter,
} from "../lib/running-header-footer";

afterEach(cleanup);

function setup(
  def: RunningHeaderFooter,
  registry = new HFImageRegistry(),
  extra: { pageNumber?: number; zoneLabel?: string } = {},
) {
  const onChange = vi.fn();
  const onFocus = vi.fn();
  render(
    <HeaderFooterZone
      def={def}
      onChange={onChange}
      registry={registry}
      pxPerPt={1}
      {...(extra.pageNumber !== undefined
        ? { pageNumber: extra.pageNumber }
        : {})}
      {...(extra.zoneLabel !== undefined ? { zoneLabel: extra.zoneLabel } : {})}
      onFocusedTextItemChange={onFocus}
    />,
  );
  return { onChange, onFocus };
}

describe("HeaderFooterZone", () => {
  it("renders a header and a footer band", () => {
    setup(emptyRunningHeaderFooter());
    expect(screen.getByTestId("header-footer-zone")).toBeInTheDocument();
    expect(
      document.querySelector('[data-hf-band="header"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-hf-band="footer"]'),
    ).not.toBeNull();
  });

  it('"add text" appends an empty text item to the band and emits a new def', () => {
    const { onChange, onFocus } = setup(emptyRunningHeaderFooter());
    const header = document.querySelector(
      '[data-hf-band="header"]',
    ) as HTMLElement;
    fireEvent.click(within(header).getByLabelText("Add text"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as RunningHeaderFooter;
    expect(next.default.header).toHaveLength(1);
    expect(next.default.header[0]).toMatchObject({ type: "text", text: "" });
    // Focus is reported for the freshly-added text item.
    expect(onFocus).toHaveBeenCalledWith(
      expect.objectContaining({ band: "header", index: 0 }),
    );
  });

  it("typing into a text item emits an updated def (bake trigger)", () => {
    const def = appendItemToDefault(
      emptyRunningHeaderFooter(),
      "footer",
      makeTextItem("Hi"),
    );
    const { onChange } = setup(def);
    const editable = screen.getByRole("textbox");
    editable.textContent = "Hello {{page}}";
    fireEvent.input(editable);

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0] as RunningHeaderFooter;
    expect(next.default.footer[0]).toMatchObject({ text: "Hello {{page}}" });
  });

  it("renders a seeded image item and deletes it on demand", () => {
    const registry = new HFImageRegistry();
    const id = registry.add(new Uint8Array([1, 2, 3]));
    const def = appendItemToDefault(
      emptyRunningHeaderFooter(),
      "header",
      makeImageItem(id, 80, 24),
    );
    const { onChange } = setup(def, registry);

    expect(screen.getByLabelText("Header/footer image")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove image"));

    const next = onChange.mock.calls.at(-1)![0] as RunningHeaderFooter;
    expect(next.default.header).toHaveLength(0);
  });

  it("SL3 — edits the firstPage zone on page 1 when differentFirstPage is set", () => {
    // Page 1, differentFirstPage on, with a seeded firstPage zone carrying a
    // text item. Typing must update firstPage (NOT default).
    let def = emptyRunningHeaderFooter();
    def = appendItemToDefault(def, "header", makeTextItem("Default H"));
    def = appendItemToZone(def, "firstPage", "header", makeTextItem("First H"));
    def = { ...def, differentFirstPage: true };

    const { onChange } = setup(def, new HFImageRegistry(), { pageNumber: 1 });
    const editable = screen.getByRole("textbox");
    // The band shows the firstPage item, not the default one.
    expect(editable.textContent).toBe("First H");

    editable.textContent = "First edited";
    fireEvent.input(editable);

    const next = onChange.mock.calls.at(-1)![0] as RunningHeaderFooter;
    expect(next.firstPage?.header[0]).toMatchObject({ text: "First edited" });
    // default zone is untouched.
    expect(next.default.header[0]).toMatchObject({ text: "Default H" });
  });

  it("SL3 — an even page edits the evenPage zone when differentOddEven is set", () => {
    let def = emptyRunningHeaderFooter();
    def = appendItemToDefault(def, "footer", makeTextItem("Default F"));
    def = appendItemToZone(def, "evenPage", "footer", makeTextItem("Even F"));
    def = { ...def, differentOddEven: true };

    // Page 2 → even zone.
    const { onChange } = setup(def, new HFImageRegistry(), { pageNumber: 2 });
    const header = document.querySelector(
      '[data-hf-band="footer"]',
    ) as HTMLElement;
    fireEvent.click(within(header).getByLabelText("Add text"));

    const next = onChange.mock.calls.at(-1)![0] as RunningHeaderFooter;
    expect(next.evenPage?.footer).toHaveLength(2);
    expect(next.default.footer).toHaveLength(1); // unchanged
  });

  it("SL3 — renders the zone indicator badge when a label is given", () => {
    setup(emptyRunningHeaderFooter(), new HFImageRegistry(), {
      pageNumber: 1,
      zoneLabel: "First page",
    });
    const badge = screen.getByTestId("hf-zone-indicator");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("First page");
  });

  it("reports the focused text item up for the toolbar", () => {
    const def = appendItemToDefault(
      emptyRunningHeaderFooter(),
      "header",
      makeTextItem("Title"),
    );
    const { onFocus } = setup(def);
    const editable = screen.getByRole("textbox");
    fireEvent.focus(editable);
    expect(onFocus).toHaveBeenCalledWith(
      expect.objectContaining({
        band: "header",
        index: 0,
        item: expect.objectContaining({ type: "text", text: "Title" }),
      }),
    );
    fireEvent.blur(editable);
    expect(onFocus).toHaveBeenLastCalledWith(null);
  });
});
