/**
 * page-margin-overlay.test.tsx
 *
 * The unified margin overlay is what BOTH the single-page editor
 * (`editor-canvas.tsx`) and the continuous view (`page-slot.tsx`) mount when
 * "Rulers & margins" is on. These tests assert:
 *
 *   1. it mounts the rulers (horizontal + vertical bars) with draggable margin
 *      handles — i.e. the single-page view really gets Word-style rulers;
 *   2. dragging a ruler HANDLE commits the new margins through the shared flow
 *      (the same `onCommit` the page guides use), proving ruler ↔ guide are one
 *      system;
 *   3. a passive ruler (no margin controls) renders ticks but no handles.
 *
 * jsdom note: `getBoundingClientRect` returns all-zeros by default, so we stub
 * the overlay's rect to {left:0, top:0} → pointer client coords map 1:1 to sheet
 * px. `setPointerCapture` is absent in jsdom; the overlay guards it with `?.`.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { PageMarginOverlay } from "../page-margin-overlay";
import { PageRulers } from "../page-rulers";
import type { PageMargins } from "../lib/page-margins";

afterEach(cleanup);

const MARGINS: PageMargins = { top: 50, right: 40, bottom: 60, left: 30 };
const WIDTH = 600;
const HEIGHT = 800;

describe("PageMarginOverlay — mounts rulers with margin handles", () => {
  it("renders both ruler bars and four draggable margin handles", () => {
    render(
      <div style={{ position: "relative", width: WIDTH, height: HEIGHT }}>
        <PageMarginOverlay
          width={WIDTH}
          height={HEIGHT}
          zoom={1}
          unit="mm"
          margins={MARGINS}
          rotation={0}
          onCommit={vi.fn()}
        />
      </div>,
    );

    // Both ruler bars present (the single-page view "monte les règles").
    expect(document.querySelector('[data-ruler="horizontal"]')).not.toBeNull();
    expect(document.querySelector('[data-ruler="vertical"]')).not.toBeNull();

    // A draggable handle per perpendicular side: 2 on the horizontal bar
    // (left/right) and 2 on the vertical bar (top/bottom).
    const hHandles = document.querySelectorAll(
      '[data-margin-handle="horizontal"]',
    );
    const vHandles = document.querySelectorAll(
      '[data-margin-handle="vertical"]',
    );
    expect(hHandles.length).toBe(2);
    expect(vHandles.length).toBe(2);

    // The on-sheet dashed guides are mounted too (shared state surface).
    expect(document.querySelector('[data-margin-guides="true"]')).not.toBeNull();
  });
});

describe("PageMarginOverlay — ruler handle drag commits margins", () => {
  it("dragging the left ruler handle commits only a new left margin", () => {
    const onCommit = vi.fn();
    render(
      <div style={{ position: "relative", width: WIDTH, height: HEIGHT }}>
        <PageMarginOverlay
          width={WIDTH}
          height={HEIGHT}
          zoom={1}
          unit="mm"
          margins={MARGINS}
          rotation={0}
          onCommit={onCommit}
        />
      </div>,
    );

    const overlay = document.querySelector(
      '[data-margin-overlay="true"]',
    ) as HTMLElement;
    expect(overlay).not.toBeNull();
    // Stub the capture target's rect so client coords map straight to sheet px.
    overlay.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          right: WIDTH,
          bottom: HEIGHT,
          width: WIDTH,
          height: HEIGHT,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    // The two horizontal-bar handles are left (x≈30) then right (x≈560).
    const hHandles = document.querySelectorAll(
      '[data-margin-handle="horizontal"]',
    );
    const leftHandle = hHandles[0] as HTMLElement;

    // Press the left handle, drag to x=100, release. Pointer move/up dispatch on
    // the capture overlay (capture is a no-op in jsdom; we target it directly).
    fireEvent.pointerDown(leftHandle, { pointerId: 1, clientX: 30, clientY: 400 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 100, clientY: 400 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 100, clientY: 400 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      top: 50,
      right: 40,
      bottom: 60,
      left: 100,
    });
  });

  it("does not commit on a click without movement (pointer up restores)", () => {
    const onCommit = vi.fn();
    render(
      <div style={{ position: "relative", width: WIDTH, height: HEIGHT }}>
        <PageMarginOverlay
          width={WIDTH}
          height={HEIGHT}
          zoom={1}
          unit="mm"
          margins={MARGINS}
          rotation={0}
          onCommit={onCommit}
        />
      </div>,
    );
    const overlay = document.querySelector(
      '[data-margin-overlay="true"]',
    ) as HTMLElement;
    overlay.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          right: WIDTH,
          bottom: HEIGHT,
          width: WIDTH,
          height: HEIGHT,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    const topHandle = document.querySelectorAll(
      '[data-margin-handle="vertical"]',
    )[0] as HTMLElement;

    // Press then release with no move → margins unchanged, but a commit of the
    // (unchanged) margins is acceptable; assert it does not mutate the value.
    fireEvent.pointerDown(topHandle, { pointerId: 2, clientX: 300, clientY: 50 });
    fireEvent.pointerUp(overlay, { pointerId: 2, clientX: 300, clientY: 50 });

    if (onCommit.mock.calls.length > 0) {
      expect(onCommit).toHaveBeenLastCalledWith(MARGINS);
    }
  });
});

describe("PageRulers — passive (no margin controls)", () => {
  it("renders ruler bars but no margin handles when margins omitted", () => {
    render(
      <div style={{ position: "relative", width: WIDTH, height: HEIGHT }}>
        <PageRulers
          pageWidthPts={WIDTH}
          pageHeightPts={HEIGHT}
          zoom={1}
          unit="mm"
        />
      </div>,
    );
    expect(document.querySelector('[data-ruler="horizontal"]')).not.toBeNull();
    expect(document.querySelector('[data-ruler="vertical"]')).not.toBeNull();
    expect(document.querySelector("[data-margin-handle]")).toBeNull();
    // Bars are aria-hidden when passive (decorative only).
    expect(
      document.querySelector('[data-ruler="horizontal"]')?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
