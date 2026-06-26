/**
 * add-page-menu.test.tsx
 *
 * The SL4 "Add page" picker. It must hand the chosen format / orientation /
 * position straight to `onAddPage` (the editor resolves the size to points via
 * `addPageParams` — covered in page-formats.test.ts — and runs the add op +
 * re-bake). Defaults are A4 / portrait / after.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// next-intl mock: every key resolves to its own path, so labels are queryable
// ("format.a4", "orientation.landscape", "add", …).
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { AddPageMenu } from "../add-page-menu";

afterEach(cleanup);

describe("AddPageMenu", () => {
  it("adds an A4 portrait page after the current page (defaults)", () => {
    const onAddPage = vi.fn();
    render(<AddPageMenu onAddPage={onAddPage} />);

    // Open the menu, then confirm with the default selection.
    fireEvent.click(screen.getByLabelText("toolbarLabel"));
    expect(screen.getByTestId("add-page-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByText("add"));

    expect(onAddPage).toHaveBeenCalledWith("a4", "portrait", "after", undefined);
  });

  it("passes the chosen format / orientation / position", () => {
    const onAddPage = vi.fn();
    render(<AddPageMenu onAddPage={onAddPage} />);

    fireEvent.click(screen.getByLabelText("toolbarLabel"));
    fireEvent.click(screen.getByText("format.a3"));
    fireEvent.click(screen.getByText("orientation.landscape"));
    fireEvent.click(screen.getByText("position.end"));
    fireEvent.click(screen.getByText("add"));

    expect(onAddPage).toHaveBeenCalledWith("a3", "landscape", "end", undefined);
  });

  it("passes custom dimensions when the custom format is chosen", () => {
    const onAddPage = vi.fn();
    render(<AddPageMenu onAddPage={onAddPage} />);

    fireEvent.click(screen.getByLabelText("toolbarLabel"));
    fireEvent.click(screen.getByText("format.custom"));
    fireEvent.change(screen.getByLabelText("customWidth"), {
      target: { value: "400" },
    });
    fireEvent.change(screen.getByLabelText("customHeight"), {
      target: { value: "650" },
    });
    fireEvent.click(screen.getByText("add"));

    expect(onAddPage).toHaveBeenCalledWith("custom", "portrait", "after", {
      width: 400,
      height: 650,
    });
  });
});
