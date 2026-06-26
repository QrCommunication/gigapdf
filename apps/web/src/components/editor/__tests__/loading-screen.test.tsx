/**
 * loading-screen.test.tsx
 *
 * L'écran de chargement de l'éditeur affiche une barre de progression + un label
 * de phase i18n + une animation de pages. Ces tests vérifient :
 *
 *   1. le label i18n de chaque phase est rendu (résolu contre les vrais messages) ;
 *   2. la barre expose role="progressbar" + une aria-label, et le pourcentage ;
 *   3. le sous-texte "Page X sur N" n'apparaît qu'en phase `elements` ;
 *   4. un statut accessible (aria-live="polite") décrit phase + valeur ;
 *   5. aucune clé i18n utilisée n'est manquante — en FR ET en EN.
 *
 * next-intl est mocké par un résolveur léger branché sur les vrais fichiers de
 * messages (apps/web/messages/{fr,en}.json) : une clé absente retourne son chemin
 * brut, ce qui rend toute clé manquante détectable par assertion.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Holder hoisté : permet de basculer FR/EN avant chaque render.
const i18n = vi.hoisted(() => ({
  messages: null as Record<string, unknown> | null,
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    return (key: string, vars?: Record<string, unknown>) => {
      const root = (i18n.messages?.[namespace] ?? {}) as Record<string, unknown>;
      let node: unknown = root;
      for (const part of key.split(".")) {
        node = node != null ? (node as Record<string, unknown>)[part] : undefined;
      }
      if (typeof node !== "string") return `${namespace}.${key}`; // manquant → détectable
      return node.replace(/\{(\w+)\}/g, (_m, name: string) =>
        vars && name in vars ? String(vars[name]) : `{${name}}`,
      );
    };
  },
}));

// Progress minimal : conserve role/aria + value, sans tirer tout le barrel UI.
vi.mock("@giga-pdf/ui", () => ({
  Progress: ({
    value,
    ...props
  }: { value?: number } & React.HTMLAttributes<HTMLDivElement>) => (
    <div role="progressbar" aria-valuenow={value} {...props} />
  ),
}));

import { LoadingScreen } from "../loading-screen";

// vitest `root` = apps/web (cf. vitest.config.ts), donc cwd pointe sur le package.
const frMessages = JSON.parse(
  readFileSync(resolve(process.cwd(), "messages/fr.json"), "utf8"),
) as Record<string, unknown>;
const enMessages = JSON.parse(
  readFileSync(resolve(process.cwd(), "messages/en.json"), "utf8"),
) as Record<string, unknown>;

const USED_KEYS = [
  "connecting",
  "analyzing",
  "elements",
  "building",
  "error",
  "pages",
  "percent",
  "aria",
  "srStatus",
] as const;

afterEach(cleanup);

describe("LoadingScreen", () => {
  it("renders the i18n phase label and a labelled progressbar with the percentage", () => {
    i18n.messages = frMessages;
    render(<LoadingScreen value={42} phase="analyzing" pagesParsed={0} pagesTotal={0} />);

    expect(screen.getByText("Analyse du PDF…")).toBeInTheDocument();

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-label", "Progression du chargement du document");

    expect(screen.getByText("42 %")).toBeInTheDocument();
  });

  it("shows 'Page X sur N' only in the elements phase", () => {
    i18n.messages = frMessages;
    const { rerender } = render(
      <LoadingScreen value={76} phase="elements" pagesParsed={2} pagesTotal={5} />,
    );
    expect(screen.getByText("Page 2 sur 5")).toBeInTheDocument();

    // Hors phase elements → pas de sous-texte de pages.
    rerender(<LoadingScreen value={95} phase="building" pagesParsed={5} pagesTotal={5} />);
    expect(screen.queryByText(/Page \d+ sur \d+/)).not.toBeInTheDocument();
  });

  it("exposes an accessible polite status describing phase + value", () => {
    i18n.messages = frMessages;
    const { container } = render(
      <LoadingScreen value={8} phase="connecting" pagesParsed={0} pagesTotal={0} />,
    );
    const status = container.querySelector('[aria-live="polite"]');
    expect(status).not.toBeNull();
    expect(status).toHaveClass("sr-only");
    expect(status?.textContent).toContain("Connexion au document…");
    expect(status?.textContent).toContain("8");
  });

  it("falls back to the connecting label for the transient 'idle' phase", () => {
    i18n.messages = frMessages;
    render(<LoadingScreen value={0} phase="idle" pagesParsed={0} pagesTotal={0} />);
    expect(screen.getByText("Connexion au document…")).toBeInTheDocument();
  });

  it("renders the English label set without missing keys", () => {
    i18n.messages = enMessages;
    render(<LoadingScreen value={50} phase="building" pagesParsed={0} pagesTotal={0} />);
    expect(screen.getByText("Preparing the editor…")).toBeInTheDocument();
    expect(screen.getByText("50 %")).toBeInTheDocument();
  });

  it("has every used loadingScreen key present in FR and EN", () => {
    for (const messages of [frMessages, enMessages]) {
      const editor = messages.editor as Record<string, unknown>;
      const loadingScreen = editor.loadingScreen as Record<string, unknown>;
      expect(loadingScreen).toBeTypeOf("object");
      for (const key of USED_KEYS) {
        expect(typeof loadingScreen[key]).toBe("string");
      }
    }
  });
});
