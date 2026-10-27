/**
 * properties-panel-page-boxes.test.tsx
 *
 * Regression (prod, 2026-10-27): on opening a document the "Page boxes" section
 * showed "could not load" until the user clicked Retry. The section read the
 * document bytes on mount, before the editor had loaded the PDF; the `null`
 * blob was treated as an error and nothing re-triggered the load. It now waits
 * for `documentRevision` and reloads when the loaded binary changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { PropertiesPanel } from "../properties-panel";

const BOX: [number, number, number, number] = [0, 0, 612, 792];
const BOXES_RESPONSE = {
  success: true,
  page: 1,
  boxes: {
    media: BOX,
    crop: BOX,
    bleed: BOX,
    trim: BOX,
    art: BOX,
    declared: { media: true, crop: false, bleed: false, trim: false, art: false },
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify(BOXES_RESPONSE), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(documentRevision: object | null) {
  const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
  const getDocumentBytes = vi.fn(async () => (documentRevision ? pdf : null));
  const props = {
    selectedElements: [],
    zoom: 1,
    pageNumber: 1,
    getDocumentBytes,
  };
  const view = render(<PropertiesPanel {...props} documentRevision={documentRevision} />);
  return { ...view, props, getDocumentBytes };
}

const pageBoxCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/pdf/page-boxes");

describe("PropertiesPanel — page boxes before the document is loaded", () => {
  it("waits instead of reporting an error while no document is loaded", async () => {
    const { getDocumentBytes } = renderPanel(null);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getDocumentBytes).not.toHaveBeenCalled();
    expect(pageBoxCalls()).toHaveLength(0);
    expect(screen.queryByText("error")).toBeNull();
    expect(screen.getByText("loading")).toBeTruthy();
  });

  it("loads the boxes as soon as the document arrives", async () => {
    const { rerender, props } = renderPanel(null);
    const loaded = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    const getDocumentBytes = vi.fn(async () => loaded);

    rerender(
      <PropertiesPanel {...props} getDocumentBytes={getDocumentBytes} documentRevision={{}} />,
    );

    await waitFor(() => expect(pageBoxCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("loading")).toBeNull());
    expect(screen.queryByText("error")).toBeNull();
  });

  it("reloads the boxes when the loaded document changes", async () => {
    const first = {};
    const { rerender, props } = renderPanel(first);
    await waitFor(() => expect(pageBoxCalls()).toHaveLength(1));

    rerender(<PropertiesPanel {...props} documentRevision={{}} />);

    await waitFor(() => expect(pageBoxCalls()).toHaveLength(2));
  });
});
