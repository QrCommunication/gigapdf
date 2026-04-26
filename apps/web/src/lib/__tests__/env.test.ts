import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("legal env validation", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NEXT_PUBLIC_LEGAL_")) {
        delete (process.env as Record<string, string | undefined>)[key];
      }
    }
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_APP_URL;
    delete (process.env as Record<string, string | undefined>).NEXT_PHASE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.restoreAllMocks();
  });

  function setLegalEnv(overrides: Record<string, string> = {}) {
    process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME = "QR Communication";
    process.env.NEXT_PUBLIC_LEGAL_COMPANY_FORM = "SAS";
    process.env.NEXT_PUBLIC_LEGAL_SIREN = "940 163 496";
    process.env.NEXT_PUBLIC_LEGAL_ADDRESS = "23 rue de Richelieu, 75001 Paris, France";
    process.env.NEXT_PUBLIC_LEGAL_PHONE = "+33 1 88 83 34 51";
    process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL = "contact@qrcommunication.com";
    process.env.NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR = "Le Président de QR Communication SAS";
    process.env.NEXT_PUBLIC_LEGAL_HOST_NAME = "Scaleway SAS";
    process.env.NEXT_PUBLIC_LEGAL_HOST_ADDRESS = "8 rue de la Ville l'Évêque, 75008 Paris, France";
    Object.assign(process.env, overrides);
  }

  it("returns parsed env when all required vars are present", async () => {
    setLegalEnv();
    vi.resetModules();
    const { env } = await import("../env");
    expect(env.NEXT_PUBLIC_LEGAL_COMPANY_NAME).toBe("QR Communication");
    expect(env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL).toBe("contact@qrcommunication.com");
    expect(env.NEXT_PUBLIC_LEGAL_SIREN).toBe("940 163 496");
  });

  it("warns in dev when env vars are missing (does not throw)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    await import("../env");
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]![0]).toContain("Legal env vars not configured");
  });

  it("throws at runtime in production when env vars are missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://giga-pdf.com";
    delete (process.env as Record<string, string | undefined>).NEXT_PHASE;
    vi.resetModules();
    await expect(import("../env")).rejects.toThrow(
      /Legal env vars are missing in production/,
    );
  });

  it("does not throw at build time (NEXT_PHASE = phase-production-build) even in production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://giga-pdf.com";
    process.env.NEXT_PHASE = "phase-production-build"; // simulates `next build` page-data collection
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    await import("../env");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("does not throw at runtime when NEXT_PUBLIC_APP_URL is localhost (dev override)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    delete (process.env as Record<string, string | undefined>).NEXT_PHASE;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    await import("../env");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("rejects an invalid email at runtime", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://giga-pdf.com";
    delete (process.env as Record<string, string | undefined>).NEXT_PHASE;
    setLegalEnv({ NEXT_PUBLIC_LEGAL_CONTACT_EMAIL: "not-an-email" });
    vi.resetModules();
    await expect(import("../env")).rejects.toThrow();
  });
});
