import { z } from "zod";

const legalSchema = z.object({
  NEXT_PUBLIC_LEGAL_COMPANY_NAME: z.string().min(1),
  NEXT_PUBLIC_LEGAL_COMPANY_FORM: z.string().min(1),
  NEXT_PUBLIC_LEGAL_SIREN: z.string().min(1),
  NEXT_PUBLIC_LEGAL_APE: z.string().optional(),
  NEXT_PUBLIC_LEGAL_ADDRESS: z.string().min(1),
  NEXT_PUBLIC_LEGAL_PHONE: z.string().min(1),
  NEXT_PUBLIC_LEGAL_CONTACT_EMAIL: z.string().email(),
  NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR: z.string().min(1),
  NEXT_PUBLIC_LEGAL_HOST_NAME: z.string().min(1),
  NEXT_PUBLIC_LEGAL_HOST_ADDRESS: z.string().min(1),
  NEXT_PUBLIC_LEGAL_HOST_PHONE: z.string().optional(),
});

type LegalEnv = z.infer<typeof legalSchema>;

const raw: Record<string, string | undefined> = {
  NEXT_PUBLIC_LEGAL_COMPANY_NAME: process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME,
  NEXT_PUBLIC_LEGAL_COMPANY_FORM: process.env.NEXT_PUBLIC_LEGAL_COMPANY_FORM,
  NEXT_PUBLIC_LEGAL_SIREN: process.env.NEXT_PUBLIC_LEGAL_SIREN,
  NEXT_PUBLIC_LEGAL_APE: process.env.NEXT_PUBLIC_LEGAL_APE,
  NEXT_PUBLIC_LEGAL_ADDRESS: process.env.NEXT_PUBLIC_LEGAL_ADDRESS,
  NEXT_PUBLIC_LEGAL_PHONE: process.env.NEXT_PUBLIC_LEGAL_PHONE,
  NEXT_PUBLIC_LEGAL_CONTACT_EMAIL: process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL,
  NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR: process.env.NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR,
  NEXT_PUBLIC_LEGAL_HOST_NAME: process.env.NEXT_PUBLIC_LEGAL_HOST_NAME,
  NEXT_PUBLIC_LEGAL_HOST_ADDRESS: process.env.NEXT_PUBLIC_LEGAL_HOST_ADDRESS,
  NEXT_PUBLIC_LEGAL_HOST_PHONE: process.env.NEXT_PUBLIC_LEGAL_HOST_PHONE,
};

// `NEXT_PHASE` is set to "phase-production-build" by Next.js during
// `next build` (including page-data collection). At true runtime it's
// "phase-production-server" or undefined. We only enforce strict
// validation at runtime — letting the build pass when env vars come
// from a different layer (Docker secrets, K8s configmaps, etc.)
// injected at deploy time. The runtime check still catches misconfigured
// deployments before any user reaches a legal page.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const isProductionDeployment =
  !isBuildPhase
  && process.env.NODE_ENV === "production"
  && process.env.NEXT_PUBLIC_APP_URL !== undefined
  && !process.env.NEXT_PUBLIC_APP_URL.startsWith("http://localhost");

const result = legalSchema.safeParse(raw);

if (!result.success) {
  if (isProductionDeployment) {
    throw new Error(
      "Legal env vars are missing in production. "
      + "Self-hosters must configure NEXT_PUBLIC_LEGAL_* per French LCEN. "
      + "See README.md → Self-hosting and apps/web/.env.example. "
      + `Validation errors: ${JSON.stringify(result.error.flatten().fieldErrors)}`,
    );
  }
  console.warn(
    "[gigapdf] Legal env vars not configured. "
    + "Legal pages will show empty values. "
    + "OK for local dev, NOT OK for production. "
    + "See apps/web/.env.example.",
  );
}

const fallback = (Object.fromEntries(
  Object.entries(raw).map(([k, v]) => [k, v ?? ""]),
) as unknown) as LegalEnv;

export const env: LegalEnv = result.success ? result.data : fallback;
