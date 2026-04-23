/**
 * Tests for operations-store
 *
 * Guards the FIFO guarantees and drain-safety semantics the save flow
 * depends on. Without these, a single lost op silently wipes user edits
 * on the next reload.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useOperationsStore } from "../stores/operations-store";
import type { Element, Bounds, UUID } from "@giga-pdf/types";

const BOUNDS: Bounds = { x: 10, y: 20, width: 100, height: 30 };

function makeTextElement(id: string): Element {
  return {
    elementId: id as UUID,
    type: "text",
    bounds: { ...BOUNDS },
    content: `Hello ${id}`,
    style: { fontSize: 12, fontFamily: "Helvetica", color: "#000000" },
  } as unknown as Element;
}

describe("useOperationsStore", () => {
  beforeEach(() => {
    useOperationsStore.getState().clear();
  });

  it("starts empty", () => {
    expect(useOperationsStore.getState().size()).toBe(0);
    expect(useOperationsStore.getState().peek()).toEqual([]);
  });

  it("queues add/update/delete in insertion order", () => {
    const store = useOperationsStore.getState();
    store.queueAdd(1, makeTextElement("a"));
    store.queueUpdate(2, makeTextElement("b"), BOUNDS);
    store.queueDelete(3, "c" as UUID, BOUNDS);

    const ops = useOperationsStore.getState().peek();
    expect(ops).toHaveLength(3);
    expect(ops[0]?.action).toBe("add");
    expect(ops[0]?.pageNumber).toBe(1);
    expect(ops[1]?.action).toBe("update");
    expect(ops[1]?.oldBounds).toEqual(BOUNDS);
    expect(ops[2]?.action).toBe("delete");
    expect(ops[2]?.pageNumber).toBe(3);
  });

  it("drain returns all ops and empties the queue", () => {
    const store = useOperationsStore.getState();
    store.queueAdd(1, makeTextElement("a"));
    store.queueAdd(1, makeTextElement("b"));

    const drained = useOperationsStore.getState().drain();
    expect(drained).toHaveLength(2);
    expect(useOperationsStore.getState().size()).toBe(0);
  });

  it("prepend reinserts ops at the head preserving order", () => {
    const store = useOperationsStore.getState();
    store.queueAdd(1, makeTextElement("existing"));

    const requeued = [
      {
        action: "add" as const,
        pageNumber: 1,
        element: makeTextElement("first"),
      },
      {
        action: "add" as const,
        pageNumber: 1,
        element: makeTextElement("second"),
      },
    ];
    useOperationsStore.getState().prepend(requeued);

    const ops = useOperationsStore.getState().peek();
    expect(ops).toHaveLength(3);
    // Requeued ops should come BEFORE the existing one — save can retry them
    // without reversing user intent.
    expect((ops[0]?.element as Element).elementId).toBe("first");
    expect((ops[1]?.element as Element).elementId).toBe("second");
    expect((ops[2]?.element as Element).elementId).toBe("existing");
  });

  it("clear drops everything without returning ops", () => {
    const store = useOperationsStore.getState();
    store.queueAdd(1, makeTextElement("a"));
    store.queueAdd(2, makeTextElement("b"));

    useOperationsStore.getState().clear();
    expect(useOperationsStore.getState().size()).toBe(0);
  });

  it("queueDelete carries elementId + bounds in the op payload", () => {
    const store = useOperationsStore.getState();
    store.queueDelete(5, "target-id" as UUID, BOUNDS);

    const [op] = useOperationsStore.getState().peek();
    expect(op?.action).toBe("delete");
    expect(op?.pageNumber).toBe(5);
    expect((op?.element as { elementId: string }).elementId).toBe("target-id");
    expect(op?.oldBounds).toEqual(BOUNDS);
  });

  it("handles rapid enqueue/drain cycles without losing ops", () => {
    const store = useOperationsStore.getState();
    for (let i = 0; i < 100; i++) {
      store.queueAdd(1, makeTextElement(`el-${i}`));
    }
    const drained = useOperationsStore.getState().drain();
    expect(drained).toHaveLength(100);
    // FIFO order preserved
    expect((drained[0]?.element as Element).elementId).toBe("el-0");
    expect((drained[99]?.element as Element).elementId).toBe("el-99");
  });
});
