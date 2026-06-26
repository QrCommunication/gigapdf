/**
 * header-footer-page-setup.test.tsx
 *
 * The SL3 Word-like page-setup switches ("different first page", "different
 * odd/even"): both render, reflect their checked state, and toggling routes the
 * callback up (the editor then flips the flag AND seeds the matching override
 * zone — that seeding is covered by `ensureZone` in the lib tests).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// next-intl mock: every key resolves to its own path, so labels are queryable.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { HeaderFooterPageSetup } from "../header-footer-page-setup";

afterEach(cleanup);

describe("HeaderFooterPageSetup", () => {
  it("renders both switches reflecting their checked state", () => {
    render(
      <HeaderFooterPageSetup
        differentFirstPage
        differentOddEven={false}
        onToggleDifferentFirstPage={vi.fn()}
        onToggleDifferentOddEven={vi.fn()}
      />,
    );
    const first = screen.getByLabelText("differentFirstPage") as HTMLInputElement;
    const oddEven = screen.getByLabelText("differentOddEven") as HTMLInputElement;
    expect(first.checked).toBe(true);
    expect(oddEven.checked).toBe(false);
  });

  it("toggling 'different first page' calls back up", () => {
    const onFirst = vi.fn();
    render(
      <HeaderFooterPageSetup
        differentFirstPage={false}
        differentOddEven={false}
        onToggleDifferentFirstPage={onFirst}
        onToggleDifferentOddEven={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("differentFirstPage"));
    expect(onFirst).toHaveBeenCalledTimes(1);
  });

  it("toggling 'different odd/even' calls back up", () => {
    const onOddEven = vi.fn();
    render(
      <HeaderFooterPageSetup
        differentFirstPage={false}
        differentOddEven={false}
        onToggleDifferentFirstPage={vi.fn()}
        onToggleDifferentOddEven={onOddEven}
      />,
    );
    fireEvent.click(screen.getByLabelText("differentOddEven"));
    expect(onOddEven).toHaveBeenCalledTimes(1);
  });
});
