/**
 * use-document-load-progress.test.tsx
 *
 * Couvre `useDocument().loadProgress` : la barre de progression synchronisée aux
 * jalons réels du chargement (A connecting → B analyzing → C elements → D building).
 *
 * Invariants vérifiés :
 *  - value monotone et bornée [0,100] ;
 *  - phase B (analyzing) = estimateur borné qui ne franchit JAMAIS 60 avant la
 *    résolution réelle du parse (≤ 58), puis SNAP à 60 ;
 *  - phase C (elements) = 60 → 92, incrémentée par X/N pages fusionnées ;
 *  - phase D (building) → 100 ;
 *  - l'estimateur (setInterval) est arrêté à la résolution (pas de fuite) ;
 *  - une erreur de parse passe la phase à 'error'.
 *
 * Les timings réseau sont contrôlés via des promesses différées (parse + pages),
 * ce qui rend les assertions sur les valeurs intermédiaires déterministes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock @/lib/api — `api` (top-level import) ET `getAuthToken` (dynamic import).
// ---------------------------------------------------------------------------
vi.mock("@/lib/api", () => ({
  api: {
    loadDocument: vi.fn(),
    getPageElements: vi.fn(),
  },
  getAuthToken: vi.fn().mockResolvedValue("test-token"),
}));

import { api } from "@/lib/api";
import { useDocument } from "../use-document";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Page minimale acceptée par le parser TS + mergeBackendElements. */
function page(n: number) {
  return {
    pageId: `p${n}`,
    pageNumber: n,
    dimensions: { width: 612, height: 792, rotation: 0 },
    mediaBox: { x: 0, y: 0, width: 612, height: 792 },
    cropBox: null,
    elements: [],
    preview: { thumbnailUrl: null, fullUrl: null },
  };
}

/** Réponse fetch minimale (le hook ne lit que .ok/.status/.json()). */
function okResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const loadDocumentMock = api.loadDocument as unknown as Mock;
const getPageElementsMock = api.getPageElements as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  loadDocumentMock.mockResolvedValue({ document_id: "doc-1", name: "Doc" });
  getPageElementsMock.mockResolvedValue({ elements: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDocument().loadProgress", () => {
  it("scales A→D, stays monotone & bounded, ends at 100/building", async () => {
    const parse = deferred<Response>();
    global.fetch = vi.fn(() => parse.promise) as unknown as typeof fetch;

    const { result } = renderHook(() => useDocument({ storedDocumentId: "s1" }));

    // B (analyzing) démarre : value bornée < 60.
    await waitFor(() => expect(result.current.loadProgress.phase).toBe("analyzing"));
    const vStart = result.current.loadProgress.value;
    expect(vStart).toBeGreaterThanOrEqual(8);
    expect(vStart).toBeLessThan(60);

    // L'estimateur tourne : reste ≤ 58 (jamais 60 avant résolution).
    await act(async () => {
      await sleep(450);
    });
    const vAnalyzing = result.current.loadProgress.value;
    expect(vAnalyzing).toBeGreaterThanOrEqual(vStart); // monotone
    expect(vAnalyzing).toBeLessThanOrEqual(58);
    expect(vAnalyzing).toBeLessThan(60);

    // Résolution du parse → snap 60 → elements → building → 100.
    await act(async () => {
      parse.resolve(okResponse({ pages: [page(1), page(2), page(3)] }));
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadProgress.phase).toBe("building");
    expect(result.current.loadProgress.value).toBe(100);
    expect(result.current.loadProgress.pagesParsed).toBe(3);
    expect(result.current.loadProgress.pagesTotal).toBe(3);
    expect(result.current.loadProgress.value).toBeGreaterThanOrEqual(vAnalyzing); // monotone
  });

  it("phase 'elements' increments 60 → 92 by X/N as pages merge", async () => {
    const parse = deferred<Response>();
    global.fetch = vi.fn(() => parse.promise) as unknown as typeof fetch;

    // Une promesse différée par page → on contrôle la cadence de fusion.
    const d1 = deferred<{ elements: [] }>();
    const d2 = deferred<{ elements: [] }>();
    getPageElementsMock.mockImplementation((_doc: string, pageNumber: number) =>
      pageNumber === 1 ? d1.promise : d2.promise,
    );

    const { result } = renderHook(() => useDocument({ storedDocumentId: "s1" }));
    await waitFor(() => expect(result.current.loadProgress.phase).toBe("analyzing"));

    await act(async () => {
      parse.resolve(okResponse({ pages: [page(1), page(2)] }));
    });

    // Snap à 60, phase elements, rien fusionné encore.
    await waitFor(() => expect(result.current.loadProgress.phase).toBe("elements"));
    expect(result.current.loadProgress.value).toBe(60);
    expect(result.current.loadProgress.pagesTotal).toBe(2);
    expect(result.current.loadProgress.pagesParsed).toBe(0);

    // Page 1 fusionnée → 60 + (1/2)*32 = 76.
    await act(async () => {
      d1.resolve({ elements: [] });
    });
    await waitFor(() => expect(result.current.loadProgress.pagesParsed).toBe(1));
    expect(result.current.loadProgress.value).toBe(76);

    // Page 2 fusionnée → 92, puis building → 100.
    await act(async () => {
      d2.resolve({ elements: [] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadProgress.pagesParsed).toBe(2);
    expect(result.current.loadProgress.phase).toBe("building");
    expect(result.current.loadProgress.value).toBe(100);
  });

  it("stops the analyzing estimator on resolution (no interval leak)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const parse = deferred<Response>();
    global.fetch = vi.fn(() => parse.promise) as unknown as typeof fetch;

    const { result } = renderHook(() => useDocument({ storedDocumentId: "s1" }));
    await waitFor(() => expect(result.current.loadProgress.phase).toBe("analyzing"));

    await act(async () => {
      parse.resolve(okResponse({ pages: [page(1)] }));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(clearSpy).toHaveBeenCalled();
    expect(result.current.loadProgress.value).toBe(100);

    // Aucun interval résiduel ne doit muter la progression après coup.
    await act(async () => {
      await sleep(300);
    });
    expect(result.current.loadProgress.value).toBe(100);
    expect(result.current.loadProgress.phase).toBe("building");
  });

  it("sets phase 'error' when the parse request fails", async () => {
    global.fetch = vi.fn(
      async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response,
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useDocument({ storedDocumentId: "s1" }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadProgress.phase).toBe("error");
    expect(result.current.error).toBeTruthy();
  });

  it("stays idle when no document id is provided", async () => {
    const { result } = renderHook(() => useDocument({}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadProgress.phase).toBe("idle");
    expect(result.current.loadProgress.value).toBe(0);
  });
});
