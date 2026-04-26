# OSS Clarification & Trademark Protection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Officially license GigaPDF as AGPL-3.0-or-later, protect the "GigaPDF" trademark, externalize personal/infra data from public files, and add the OSS community files (TRADEMARK, SECURITY, CoC, DCO, templates) — all in a single big-bang PR.

**Architecture:** Three parallel tracks (legal docs / code refactoring / communication) converging into one branch `chore/oss-trademark-clarification`. Strict trademark policy (rebranding mandatory for forks). Strict env validation (Zod) so production crashes if legal env vars are missing. DCO sign-off enforced via GitHub Action on every commit.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5.8, Zod, next-intl, GNU AGPL-3.0-or-later, CC-BY-ND 4.0 (logos), `tim-actions/dco@v1.1.0` (SHA-pinned), Contributor Covenant 2.1.

---

## File Structure

### Files to CREATE (21)

| Path | Responsibility |
|------|----------------|
| `LICENSE` | GNU AGPLv3 verbatim — legal license of the project |
| `TRADEMARK.md` | Trademark policy (strict, rebranding required for modified forks) |
| `SECURITY.md` | Vulnerability reporting process via contact@qrcommunication.com |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 verbatim |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Bug report form |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Feature request form |
| `.github/ISSUE_TEMPLATE/security.md` | Security issue redirect to SECURITY.md |
| `.github/ISSUE_TEMPLATE/config.yml` | Disable blank issues |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist (DCO, tests, docs) |
| `.github/workflows/dco.yml` | DCO check on every PR |
| `apps/web/src/lib/env.ts` | Zod-validated public legal env vars |
| `apps/web/src/lib/__tests__/env.test.ts` | Tests for env.ts validation |
| `apps/web/src/app/(legal)/legal-notice/page.tsx` | Mentions légales LCEN |
| `apps/web/src/app/(legal)/cookies/page.tsx` | Cookies policy page |
| `branding/README.md` | Logo assets index, usage, license |
| `branding/LICENSE` | CC-BY-ND 4.0 verbatim |
| `branding/logo-icon.svg` | Logo icon (light) — copy of apps/web/public |
| `branding/logo-icon-dark.svg` | Logo icon (dark) |
| `branding/logo-horizontal.svg` | Logo horizontal |
| `branding/logo-stacked.svg` | Logo stacked |
| `docs/oss/README.md` | OSS docs index |

### Files to MODIFY (30+)

License field added to:
- `package.json` (root + 16 workspaces) → 17 files

Code refactoring:
- `apps/web/src/app/(legal)/privacy/page.tsx` (remove hardcoded email + identity)
- `apps/web/src/app/(legal)/terms/page.tsx` (remove hardcoded identity)
- `apps/web/src/components/footer.tsx` (4 legal links + license badge)
- `apps/web/.env.example`
- `apps/admin/.env.example`
- `deploy/.env.production.example`
- `deploy/push-deploy.sh` (require env var)
- `deploy/redeploy.sh` (require env var)
- `deploy/setup-server.sh` (placeholder IP)
- `docs/deployment.md` (4 IP occurrences)
- `docs/security/SECRETS_AUDIT_FINDINGS.md` (2 IP occurrences)
- `.claude/SESSION_20260423_023327_quality_audit_refactor/FINAL_REPORT.md` (1 IP occurrence)
- `.gitignore` (cleanup patterns)
- `README.md` (full rewrite)
- `CONTRIBUTING.md` (URL update + DCO section)
- `CHANGELOG.md` (v1.0.0-oss entry)

### Translations (next-intl)

- `apps/web/messages/fr.json` — update `legal.privacy.controller.*` and `legal.terms.identity.*` keys (replace personal info with QR Communication)
- New keys for `legal-notice` and `cookies` are NOT added to messages — pages are hardcoded in French (i18n EN is out of scope, see Section 12 of the spec)

---

## Pre-flight Checks

- [ ] **Step 0.1: Verify clean working tree**

Run: `git status --short`
Expected: only untracked files (screenshots, .claude sessions). No staged/unstaged tracked changes.

- [ ] **Step 0.2: Verify on `main` branch**

Run: `git branch --show-current`
Expected: `main`

- [ ] **Step 0.3: Pull latest**

Run: `git pull origin main --ff-only`
Expected: "Already up to date." or fast-forward.

- [ ] **Step 0.4: Create feature branch**

Run: `git checkout -b chore/oss-trademark-clarification`
Expected: `Switched to a new branch 'chore/oss-trademark-clarification'`

- [ ] **Step 0.5: Configure git for DCO sign-off in this repo**

Run: `git config commit.gpgsign false && git config user.name "Rony Licha" && git config user.email "rony@qrcommunication.com"`

Note: Use whichever email is appropriate for QrCommunication contributions. The DCO uses this email in `Signed-off-by:` lines.

- [ ] **Step 0.6: Verify pnpm install works**

Run: `pnpm install --frozen-lockfile 2>&1 | tail -5`
Expected: "Done in Xs" or similar success.

---

## Task 1: Add LICENSE and license fields

**Goal:** Resolve the legal ambiguity (public repo without LICENSE = "all rights reserved"). Make AGPLv3 official.

**Files:**
- Create: `LICENSE`
- Modify: `package.json` (root)
- Modify: `apps/web/package.json`, `apps/admin/package.json`, `apps/mobile/package.json`
- Modify: `packages/{api,billing,canvas,editor,embed,eslint-config,logger,pdf-engine,s3,tailwind-config,typescript-config,types,ui}/package.json`

- [ ] **Step 1.1: Download AGPLv3 license text**

Run: `curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE && wc -l LICENSE`
Expected: ~661 lines, file `LICENSE` created.

- [ ] **Step 1.2: Verify LICENSE checksum (defense against MITM)**

Run: `sha256sum LICENSE`
Expected: `8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef  LICENSE`
(If checksum differs, the GNU file may have been updated — manually verify content starts with "GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007")

- [ ] **Step 1.3: Add license to root package.json**

Edit `package.json` — locate the existing fields and add (after `"description"`):

```json
  "license": "AGPL-3.0-or-later",
  "author": "QR Communication SAS <contact@qrcommunication.com>",
  "homepage": "https://github.com/QrCommunication/gigapdf#readme",
  "repository": {
    "type": "git",
    "url": "https://github.com/QrCommunication/gigapdf.git"
  },
  "bugs": {
    "url": "https://github.com/QrCommunication/gigapdf/issues"
  },
```

- [ ] **Step 1.4: Add license field to all workspace package.json files**

Run this script to add `"license": "AGPL-3.0-or-later"` after the `"name"` field in each workspace package.json:

```bash
for f in apps/web/package.json apps/admin/package.json apps/mobile/package.json \
         packages/api/package.json packages/billing/package.json \
         packages/canvas/package.json packages/editor/package.json \
         packages/embed/package.json packages/eslint-config/package.json \
         packages/logger/package.json packages/pdf-engine/package.json \
         packages/s3/package.json packages/tailwind-config/package.json \
         packages/typescript-config/package.json packages/types/package.json \
         packages/ui/package.json; do
  if ! grep -q '"license"' "$f"; then
    # Insert "license" field right after "name" line, preserving JSON structure
    node -e "const fs=require('fs'); const p='$f'; const j=JSON.parse(fs.readFileSync(p,'utf8')); const ordered={}; for(const k of Object.keys(j)){ ordered[k]=j[k]; if(k==='name') ordered.license='AGPL-3.0-or-later'; } fs.writeFileSync(p, JSON.stringify(ordered, null, 2)+'\n');"
    echo "✓ $f"
  else
    echo "↷ $f (already has license)"
  fi
done
```

Expected: 16 lines `✓ <path>` printed.

- [ ] **Step 1.5: Verify all package.json have license field**

Run: `grep -L '"license"' package.json apps/*/package.json packages/*/package.json`
Expected: empty output (no file is missing the field).

- [ ] **Step 1.6: Verify JSON validity**

Run: `for f in package.json apps/*/package.json packages/*/package.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"; done`
Expected: no "INVALID" output.

- [ ] **Step 1.7: Verify pnpm still works**

Run: `pnpm install --frozen-lockfile 2>&1 | tail -3`
Expected: success without lockfile changes.

- [ ] **Step 1.8: Commit**

```bash
git add LICENSE package.json apps/*/package.json packages/*/package.json
git commit -s -m "chore(license): add LICENSE (AGPLv3) and license fields to all package.json

Resolves the legal ambiguity of the previously public repository
which had no LICENSE file. The README announced 'MIT' but no
actual license was published — legally meaning 'all rights reserved'.

Choosing GNU AGPL-3.0-or-later to ensure improvements made by SaaS
operators are contributed back to the community (project's stated
goal). All 17 package.json files declare the license per SPDX.

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 2: Add TRADEMARK.md (strict policy)

**Goal:** Document the trademark policy. Forks must rebrand. Hosting an unmodified copy is allowed with disclaimer.

**Files:**
- Create: `TRADEMARK.md`

- [ ] **Step 2.1: Create TRADEMARK.md**

Create `TRADEMARK.md` with the following content:

```markdown
# Trademark Policy — GigaPDF

The GigaPDF source code is open source under the
[GNU AGPL-3.0-or-later](LICENSE) license.

The "**GigaPDF**" name and logo are trademarks of **QR Communication SAS**
(SIREN 940 163 496, 23 rue de Richelieu, 75001 Paris, France).

> **Note:** A French INPI trademark application is being filed.
> This document will be updated with the application number once
> the filing is complete.

This policy explains acceptable and unacceptable uses of the trademark
to protect users from confusion and the project from misrepresentation.

## ✅ Allowed without permission

- Refer to GigaPDF in articles, blog posts, books, talks, tutorials.
- Indicate compatibility ("plugin for GigaPDF", "GigaPDF-compatible").
- Run an unmodified copy of GigaPDF for personal or internal use.
- Host an **unmodified** copy as a service for end users, **provided
  the service page clearly states**:

  > "Hosted GigaPDF service operated by [Your Company]. Not affiliated
  > with QR Communication SAS or the official GigaPDF project."

## ❌ Not allowed without written permission

- Distributing a **modified version** under the name "GigaPDF" or any
  confusingly similar name. **Forks with code modifications must
  rebrand entirely** (different primary name, different logo, different
  domain). The fork README may state "based on GigaPDF v<x.y.z>".
- Using the GigaPDF logo on commercial materials suggesting endorsement.
- Domain names containing "gigapdf" suggesting official affiliation
  (e.g., gigapdf-pro.com, official-gigapdf.io, gigapdfhosting.com).
- Selling merchandise bearing the GigaPDF name or logo.
- Registering "GigaPDF" or any confusingly similar mark as a trademark
  in any jurisdiction.

## 📧 Permission requests

Send to: **contact@qrcommunication.com**

Subject line: `[Trademark] Your request`. Typical response time: 7 days.

## Logo assets

Logo files are available in the [`branding/`](branding/) folder
under [**CC-BY-ND 4.0**](https://creativecommons.org/licenses/by-nd/4.0/)
(attribution required, no derivative works).

The code itself remains AGPLv3.

## Why this policy?

GigaPDF is built and maintained by QR Communication SAS in Paris.
We want the open source community to thrive, but we also need to
prevent confusion: a user finding "GigaPDF Pro" online should know
whether it's the official project or an unrelated fork.

The strict rebranding rule for modified forks is the same approach
used by Mozilla (Firefox), the Linux Foundation (Kubernetes), and
many other open source projects.

## Contact

QR Communication SAS
23 rue de Richelieu, 75001 Paris, France
contact@qrcommunication.com — +33 1 88 83 34 51
```

- [ ] **Step 2.2: Verify file**

Run: `wc -l TRADEMARK.md && head -5 TRADEMARK.md`
Expected: ~75 lines, starts with `# Trademark Policy — GigaPDF`.

- [ ] **Step 2.3: Commit**

```bash
git add TRADEMARK.md
git commit -s -m "feat(legal): add TRADEMARK.md with strict policy

The 'GigaPDF' name and logo are trademarks of QR Communication SAS.
Forks with code modifications must rebrand entirely (different name,
logo, domain). Unmodified hosting is allowed with disclaimer.

INPI filing pending — application number will be added later.

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 3: Add SECURITY.md and CODE_OF_CONDUCT.md

**Goal:** Standard OSS community files for vulnerability reporting and contributor behavior.

**Files:**
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 3.1: Create SECURITY.md**

Create `SECURITY.md` with:

```markdown
# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, send a report through one of these channels:

### Option 1 — GitHub Security Advisory (preferred)

1. Go to https://github.com/QrCommunication/gigapdf/security/advisories/new
2. Fill in the form with as much detail as possible
3. Submit privately

### Option 2 — Email

Send to: **contact@qrcommunication.com**

Subject line: `[Security] Brief description`

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (data exposure, privilege escalation, DoS, etc.)
- Affected versions / commits if known
- Your name / handle for credit (optional)

## Response timeline

| Severity | Initial response | Fix target |
|----------|------------------|------------|
| Critical | < 24 hours | < 7 days |
| High | < 48 hours | < 14 days |
| Medium | < 7 days | Next minor release |
| Low | < 14 days | Next minor release |

## Disclosure policy

We follow **coordinated disclosure**:

1. We confirm the vulnerability and assess severity
2. We develop and test a fix
3. We release the fix and a security advisory **simultaneously**
4. We credit the reporter in the advisory (unless they prefer anonymity)
5. We disclose details publicly after the fix is widely deployed

Please give us a reasonable time to investigate and patch before any
public disclosure (typically 90 days, negotiable for critical issues).

## Supported versions

Only the `main` branch and the latest release receive security fixes.
Self-hosters are responsible for keeping their installation up to date.

## Out of scope

The following are NOT considered vulnerabilities:

- Self-hosting misconfiguration (weak passwords, missing TLS, etc.)
- Vulnerabilities in dependencies already reported upstream
- Social engineering / phishing not involving the GigaPDF software
- Best practice deviations without exploitable impact (e.g., missing
  `X-Frame-Options` header on a route that only renders GET data)

## Recognition

Contributors who report valid vulnerabilities are credited in
`SECURITY-CREDITS.md` and the relevant GitHub Security Advisory.
We don't currently offer bug bounties.

---

**QR Communication SAS** — 23 rue de Richelieu, 75001 Paris, France
```

- [ ] **Step 3.2: Download Contributor Covenant 2.1**

Run:
```bash
curl -fsSL https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md -o CODE_OF_CONDUCT.md
```

Expected: file created, ~135 lines.

- [ ] **Step 3.3: Replace contact placeholder in CODE_OF_CONDUCT.md**

The downloaded file contains `[INSERT CONTACT METHOD]`. Replace it:

```bash
sed -i 's|\[INSERT CONTACT METHOD\]|contact@qrcommunication.com|g' CODE_OF_CONDUCT.md
```

- [ ] **Step 3.4: Verify replacement**

Run: `grep -c "INSERT CONTACT" CODE_OF_CONDUCT.md && grep -c "contact@qrcommunication.com" CODE_OF_CONDUCT.md`
Expected: `0` (no remaining placeholders) and `1` or more.

- [ ] **Step 3.5: Commit**

```bash
git add SECURITY.md CODE_OF_CONDUCT.md
git commit -s -m "feat(legal): add SECURITY.md and CODE_OF_CONDUCT.md

SECURITY.md: vulnerability reporting via GitHub Security Advisories
or contact@qrcommunication.com, with response SLA per severity.

CODE_OF_CONDUCT.md: Contributor Covenant 2.1 verbatim, contact
points to contact@qrcommunication.com.

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 4: Build lib/env.ts with Zod strict validation (TDD)

**Goal:** Centralized, type-safe access to legal env vars. Crashes in production if missing, warns in dev. Self-hosters get clear error messages.

**Files:**
- Create: `apps/web/src/lib/env.ts`
- Create: `apps/web/src/lib/__tests__/env.test.ts`

- [ ] **Step 4.1: Verify Zod is already a dependency**

Run: `grep -l '"zod"' apps/web/package.json packages/*/package.json | head -3`
Expected: at least `apps/web/package.json` listed (used by better-auth and form validation).

If Zod is missing in apps/web:
```bash
pnpm --filter web add zod
```

- [ ] **Step 4.2: Check existing test setup**

Run: `find apps/web -name "*.test.ts" -not -path "*/node_modules/*" | head -3 && ls apps/web/vitest.config.* apps/web/jest.config.* 2>/dev/null`
Expected: identify test runner. If neither vitest nor jest is configured at apps/web level, the env tests will use the root test config.

If no test config is present in apps/web, add one:

Create `apps/web/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

And add to `apps/web/package.json` scripts (if not already present):
```json
"test": "vitest run"
```

Install vitest if missing:
```bash
pnpm --filter web add -D vitest
```

- [ ] **Step 4.3: Write the failing test**

Create `apps/web/src/lib/__tests__/env.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("legal env validation", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    // Reset to a clean baseline before each test
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NEXT_PUBLIC_LEGAL_")) {
        delete process.env[key];
      }
    }
    delete process.env.NODE_ENV;
    delete process.env.NEXT_PUBLIC_APP_URL;
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
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    await import("../env");
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]![0]).toContain("Legal env vars not configured");
  });

  it("throws in production when env vars are missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://giga-pdf.com";
    vi.resetModules();
    await expect(import("../env")).rejects.toThrow(
      /Legal env vars are missing in production/,
    );
  });

  it("does not throw in production when NEXT_PUBLIC_APP_URL is localhost (dev override)", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    await import("../env");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://giga-pdf.com";
    setLegalEnv({ NEXT_PUBLIC_LEGAL_CONTACT_EMAIL: "not-an-email" });
    vi.resetModules();
    await expect(import("../env")).rejects.toThrow();
  });
});
```

- [ ] **Step 4.4: Run the failing test**

Run: `cd apps/web && pnpm exec vitest run src/lib/__tests__/env.test.ts`
Expected: FAIL with "Cannot find module '../env'" or similar.

- [ ] **Step 4.5: Implement env.ts**

Create `apps/web/src/lib/env.ts`:

```typescript
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

const isProductionDeployment =
  process.env.NODE_ENV === "production"
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
```

- [ ] **Step 4.6: Run tests to verify they pass**

Run: `cd apps/web && pnpm exec vitest run src/lib/__tests__/env.test.ts`
Expected: 5 passed.

- [ ] **Step 4.7: Type check**

Run: `cd apps/web && pnpm exec tsc --noEmit src/lib/env.ts 2>&1 | head -10`
Expected: no errors. (If isolatedModules complains, run `pnpm --filter web type-check` instead.)

- [ ] **Step 4.8: Add env vars to apps/web/.env.example**

Edit `apps/web/.env.example` — append at the end:

```bash

# ─── Legal information (LCEN compliance) ───
# REQUIRED in production. The app refuses to start without these
# unless NEXT_PUBLIC_APP_URL is localhost.
NEXT_PUBLIC_LEGAL_COMPANY_NAME=QR Communication
NEXT_PUBLIC_LEGAL_COMPANY_FORM=SAS
NEXT_PUBLIC_LEGAL_SIREN=940 163 496
NEXT_PUBLIC_LEGAL_APE=73.12Z
NEXT_PUBLIC_LEGAL_ADDRESS=23 rue de Richelieu, 75001 Paris, France
NEXT_PUBLIC_LEGAL_PHONE=+33 1 88 83 34 51
NEXT_PUBLIC_LEGAL_CONTACT_EMAIL=contact@qrcommunication.com
NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR=Le Président de QR Communication SAS
NEXT_PUBLIC_LEGAL_HOST_NAME=Scaleway SAS
NEXT_PUBLIC_LEGAL_HOST_ADDRESS=8 rue de la Ville l'Évêque, 75008 Paris, France
NEXT_PUBLIC_LEGAL_HOST_PHONE=+33 1 84 13 00 00
```

- [ ] **Step 4.9: Commit**

```bash
git add apps/web/src/lib/env.ts apps/web/src/lib/__tests__/env.test.ts apps/web/.env.example
# If vitest config and dependencies were added in Step 4.2:
git add -p apps/web/package.json apps/web/vitest.config.ts pnpm-lock.yaml 2>/dev/null || true
git commit -s -m "feat(env): add lib/env.ts with strict legal config (Zod validation)

- Production deployment without NEXT_PUBLIC_LEGAL_* env vars crashes
  at startup with explicit error pointing to README.md
- Local dev shows console.warn but allows the app to run with empty
  legal values (acceptable UX for development)
- 5 unit tests cover: happy path, dev warning, prod throw, localhost
  override, invalid email rejection

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 5: Rewrite legal pages (privacy, terms) and create new ones (legal-notice, cookies)

**Goal:** All 4 legal pages compliant with LCEN + RGPD, sourcing identity from env.ts (no hardcoded personal info).

**Files:**
- Create: `apps/web/src/app/(legal)/legal-notice/page.tsx`
- Create: `apps/web/src/app/(legal)/cookies/page.tsx`
- Modify: `apps/web/src/app/(legal)/privacy/page.tsx`
- Modify: `apps/web/src/app/(legal)/terms/page.tsx`

- [ ] **Step 5.1: Create the mentions légales page**

Create `apps/web/src/app/(legal)/legal-notice/page.tsx`:

```tsx
import { env } from "@/lib/env";
import { Building2, Server, ShieldCheck, Mail } from "lucide-react";

export const metadata = {
  title: "Mentions légales | GigaPDF",
  description: "Mentions légales de l'éditeur du service GigaPDF, conformément à la LCEN.",
};

export default function LegalNoticePage() {
  return (
    <div className="max-w-none">
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm mb-6">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-mono text-primary">legal-notice</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Mentions légales</h1>
        <p className="text-muted-foreground font-mono text-sm">
          <span className="text-terminal-green">$</span> last_updated: 2026-04-26
        </p>
      </div>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">Éditeur du site</h2>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-1">
          <p><span className="text-terminal-cyan">raison_sociale:</span> "{env.NEXT_PUBLIC_LEGAL_COMPANY_NAME}"</p>
          <p><span className="text-terminal-cyan">forme_juridique:</span> "{env.NEXT_PUBLIC_LEGAL_COMPANY_FORM}"</p>
          <p><span className="text-terminal-cyan">siren:</span> "{env.NEXT_PUBLIC_LEGAL_SIREN}"</p>
          {env.NEXT_PUBLIC_LEGAL_APE && (
            <p><span className="text-terminal-cyan">ape:</span> "{env.NEXT_PUBLIC_LEGAL_APE}"</p>
          )}
          <p><span className="text-terminal-cyan">siege_social:</span> "{env.NEXT_PUBLIC_LEGAL_ADDRESS}"</p>
          <p><span className="text-terminal-cyan">telephone:</span> "{env.NEXT_PUBLIC_LEGAL_PHONE}"</p>
          <p><span className="text-terminal-cyan">email:</span> <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">"{env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}"</a></p>
          <p><span className="text-terminal-cyan">directeur_publication:</span> "{env.NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR}"</p>
        </div>
      </section>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Server className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold m-0">Hébergeur</h2>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-1">
          <p><span className="text-terminal-cyan">nom:</span> "{env.NEXT_PUBLIC_LEGAL_HOST_NAME}"</p>
          <p><span className="text-terminal-cyan">adresse:</span> "{env.NEXT_PUBLIC_LEGAL_HOST_ADDRESS}"</p>
          {env.NEXT_PUBLIC_LEGAL_HOST_PHONE && (
            <p><span className="text-terminal-cyan">telephone:</span> "{env.NEXT_PUBLIC_LEGAL_HOST_PHONE}"</p>
          )}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Propriété intellectuelle</h2>
        <p className="text-muted-foreground leading-relaxed">
          Le code source de GigaPDF est distribué sous licence{" "}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            GNU AGPL-3.0-or-later
          </a>. Vous pouvez le consulter sur{" "}
          <a href="https://github.com/QrCommunication/gigapdf" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            github.com/QrCommunication/gigapdf
          </a>.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          La marque <strong>« GigaPDF »</strong> et le logo associé sont la propriété
          exclusive de {env.NEXT_PUBLIC_LEGAL_COMPANY_NAME} {env.NEXT_PUBLIC_LEGAL_COMPANY_FORM}.
          Voir notre{" "}
          <a href="https://github.com/QrCommunication/gigapdf/blob/main/TRADEMARK.md" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            politique de marque
          </a>.
        </p>
      </section>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">Contact</h2>
        </div>
        <p className="text-muted-foreground">
          Pour toute question concernant ces mentions légales, contactez-nous à{" "}
          <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
            {env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 5.2: Create the cookies page**

Create `apps/web/src/app/(legal)/cookies/page.tsx`:

```tsx
import { env } from "@/lib/env";
import { Cookie, ShieldCheck, Mail } from "lucide-react";

export const metadata = {
  title: "Politique relative aux cookies | GigaPDF",
  description: "Politique GigaPDF relative aux cookies — uniquement strictement nécessaires.",
};

export default function CookiesPage() {
  return (
    <div className="max-w-none">
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm mb-6">
          <Cookie className="h-4 w-4 text-primary" />
          <span className="font-mono text-primary">cookies-policy</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Politique relative aux cookies</h1>
        <p className="text-muted-foreground font-mono text-sm">
          <span className="text-terminal-green">$</span> last_updated: 2026-04-26
        </p>
      </div>

      <section className="mb-12">
        <p className="text-muted-foreground leading-relaxed text-lg">
          GigaPDF utilise un nombre minimal de cookies, tous strictement nécessaires
          au fonctionnement du service. <strong>Aucun cookie de tracking, publicité
          ou analytics tiers</strong> n'est déposé.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Cookies utilisés</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card/50 not-prose">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Nom</th>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Finalité</th>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Durée</th>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Type</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              <tr className="border-t border-border">
                <td className="px-4 py-3"><code>better-auth.session_token</code></td>
                <td className="px-4 py-3">Session authentifiée</td>
                <td className="px-4 py-3">7 jours</td>
                <td className="px-4 py-3">Strictement nécessaire (httpOnly + Secure)</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3"><code>better-auth.csrf_token</code></td>
                <td className="px-4 py-3">Protection CSRF</td>
                <td className="px-4 py-3">Session</td>
                <td className="px-4 py-3">Strictement nécessaire</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3"><code>NEXT_LOCALE</code></td>
                <td className="px-4 py-3">Préférence de langue</td>
                <td className="px-4 py-3">1 an</td>
                <td className="px-4 py-3">Strictement nécessaire (UX)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold m-0">Pas de bannière de consentement ?</h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Conformément aux directives CNIL (lignes directrices et recommandations
          du 17 septembre 2020), les cookies strictement nécessaires ne requièrent
          pas de consentement préalable. Aucune bannière n'est donc affichée.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Si vous activez une intégration tierce (par exemple, l'intégration PDF
          embed sur un site externe), des cookies tiers peuvent s'ajouter dans le
          cadre de cette intégration ; ils sont alors régis par la politique du
          site qui héberge l'intégration.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Comment désactiver les cookies</h2>
        <p className="text-muted-foreground leading-relaxed">
          Vous pouvez configurer votre navigateur pour bloquer tous les cookies.
          <strong> Note importante</strong> : le service ne fonctionnera plus si
          vous le faites (impossible de rester connecté ; les préférences seront
          perdues à chaque rechargement).
        </p>
      </section>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">Contact</h2>
        </div>
        <p className="text-muted-foreground">
          Pour toute question relative à cette politique :{" "}
          <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
            {env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 5.3: Update privacy page — replace hardcoded contact info**

Open `apps/web/src/app/(legal)/privacy/page.tsx` and locate the "Data Controller" section (around lines 38-48):

```tsx
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-1">
          <p><span className="text-terminal-cyan">name:</span> "Rony Licha"</p>
          <p><span className="text-terminal-cyan">role:</span> "Independent Developer"</p>
          <p><span className="text-terminal-cyan">location:</span> "Paris, France"</p>
          <p><span className="text-terminal-cyan">email:</span> <a href="mailto:rony@ronylicha.net" className="text-primary hover:underline">"rony@ronylicha.net"</a></p>
          <p><span className="text-terminal-cyan">website:</span> <a href="https://ronylicha.net" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">"ronylicha.net"</a></p>
        </div>
```

Replace with:

```tsx
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-1">
          <p><span className="text-terminal-cyan">name:</span> "{env.NEXT_PUBLIC_LEGAL_COMPANY_NAME}"</p>
          <p><span className="text-terminal-cyan">form:</span> "{env.NEXT_PUBLIC_LEGAL_COMPANY_FORM}"</p>
          <p><span className="text-terminal-cyan">siren:</span> "{env.NEXT_PUBLIC_LEGAL_SIREN}"</p>
          <p><span className="text-terminal-cyan">address:</span> "{env.NEXT_PUBLIC_LEGAL_ADDRESS}"</p>
          <p><span className="text-terminal-cyan">email:</span> <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">"{env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}"</a></p>
        </div>
```

Add the import at the top of the file (after existing imports):

```tsx
import { env } from "@/lib/env";
```

- [ ] **Step 5.4: Search and replace any other rony@ or ronylicha occurrences in privacy page**

Run: `grep -n "rony@ronylicha\|ronylicha\.net\|Rony Licha\|Independent Developer" apps/web/src/app/\(legal\)/privacy/page.tsx`

For each match, replace inline using `env.NEXT_PUBLIC_LEGAL_*` or remove the field if it doesn't fit the company entity.

- [ ] **Step 5.5: Update terms page identically**

Open `apps/web/src/app/(legal)/terms/page.tsx` and locate the email/identity references (around line 54 per audit):

```tsx
            <p><span className="text-terminal-cyan">email:</span> <a href="mailto:rony@ronylicha.net" className="text-primary hover:underline">"rony@ronylicha.net"</a></p>
```

Replace with:

```tsx
            <p><span className="text-terminal-cyan">email:</span> <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">"{env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}"</a></p>
```

Add the import:

```tsx
import { env } from "@/lib/env";
```

Search for and replace all other occurrences:
```bash
grep -n "rony@ronylicha\|ronylicha\.net\|Rony Licha" apps/web/src/app/\(legal\)/terms/page.tsx
```

For each match in `terms/page.tsx`, apply the same replacement strategy as Step 5.3.

- [ ] **Step 5.6: Verify no personal info remains in legal pages**

Run: `grep -rE "rony@ronylicha\.net|ronylicha\.net|Rony Licha" apps/web/src/app/\(legal\)/`
Expected: empty output.

- [ ] **Step 5.7: Set legal env vars locally and start dev server**

Create `apps/web/.env.local` (NOT committed):

```bash
NEXT_PUBLIC_LEGAL_COMPANY_NAME=QR Communication
NEXT_PUBLIC_LEGAL_COMPANY_FORM=SAS
NEXT_PUBLIC_LEGAL_SIREN=940 163 496
NEXT_PUBLIC_LEGAL_APE=73.12Z
NEXT_PUBLIC_LEGAL_ADDRESS=23 rue de Richelieu, 75001 Paris, France
NEXT_PUBLIC_LEGAL_PHONE=+33 1 88 83 34 51
NEXT_PUBLIC_LEGAL_CONTACT_EMAIL=contact@qrcommunication.com
NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR=Le Président de QR Communication SAS
NEXT_PUBLIC_LEGAL_HOST_NAME=Scaleway SAS
NEXT_PUBLIC_LEGAL_HOST_ADDRESS=8 rue de la Ville l'Évêque, 75008 Paris, France
NEXT_PUBLIC_LEGAL_HOST_PHONE=+33 1 84 13 00 00
```

Verify `.env.local` is gitignored:
```bash
grep -E "^(\.env\.local|\.env)" .gitignore
```

- [ ] **Step 5.8: Visual smoke test — start dev server and check pages**

Run in one terminal: `pnpm --filter web dev`

Then open in browser:
- http://localhost:3000/legal-notice → should display QR Communication info
- http://localhost:3000/cookies → should display the 3-cookie table
- http://localhost:3000/privacy → should show updated controller info (QR Communication, not Rony Licha)
- http://localhost:3000/terms → should show updated email (contact@qrcommunication.com)

Stop the dev server (`Ctrl-C`).

- [ ] **Step 5.9: Commit**

```bash
git add apps/web/src/app/\(legal\)/legal-notice/page.tsx \
        apps/web/src/app/\(legal\)/cookies/page.tsx \
        apps/web/src/app/\(legal\)/privacy/page.tsx \
        apps/web/src/app/\(legal\)/terms/page.tsx
git commit -s -m "feat(legal): rewrite privacy + terms, add legal-notice + cookies pages

- New /legal-notice page (LCEN art. 6-III): editor + host + IP rights
- New /cookies page (CNIL 2020): 3 strictly necessary cookies, no banner
- /privacy + /terms: hardcoded personal info replaced by env.NEXT_PUBLIC_LEGAL_*
  (company entity instead of independent developer)
- All identity values come from lib/env.ts (Zod-validated)

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 6: Update footer with 4 legal links + GitHub icon + license badge

**Goal:** Footer exposes the 4 legal pages and points to the new repo URL.

**Files:**
- Modify: `apps/web/src/components/footer.tsx`

- [ ] **Step 6.1: Identify footer translation keys for legal section**

Run: `grep -A2 -B1 "legal\|legal-notice\|cookies\|privacy\|terms" apps/web/messages/*.json 2>/dev/null | head -30`

Identify the existing key for legal links (if any) — typically `landing.footer.legal.{title,privacy,terms,...}`.

- [ ] **Step 6.2: Update footer.tsx — replace GitHub URL and add 4 legal links**

Open `apps/web/src/components/footer.tsx`. Locate the GitHub link:

```tsx
<a
  href="https://github.com/ronylicha/gigapdf"
```

Replace with:

```tsx
<a
  href="https://github.com/QrCommunication/gigapdf"
```

Then, locate the legal links section (`landing.footer.legal.*` block — likely uses `<Link href="/privacy">` and `<Link href="/terms">`). Replace it with:

```tsx
          {/* Legal Links */}
          <div>
            <h4 className="font-semibold mb-4 text-sm uppercase tracking-wider text-muted-foreground">
              Légal
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/legal-notice" className="text-muted-foreground hover:text-foreground transition-colors">
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                  Confidentialité
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                  CGU
                </Link>
              </li>
              <li>
                <Link href="/cookies" className="text-muted-foreground hover:text-foreground transition-colors">
                  Cookies
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/QrCommunication/gigapdf/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  AGPL-3.0
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>
```

Note: if the existing footer uses `t("landing.footer.legal.*")` translations, you can keep them and add the new keys to `messages/{fr,en}.json`. The hardcoded version above is acceptable for the same scope reason as new pages (i18n EN out of scope).

- [ ] **Step 6.3: Verify all 4 routes resolve**

Run: `pnpm --filter web dev` in one terminal, then in another:

```bash
for route in / /legal-notice /privacy /terms /cookies; do
  echo "=== $route ==="
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000$route"
done
```

Expected: `200` for all 5.

Stop dev server.

- [ ] **Step 6.4: Commit**

```bash
git add apps/web/src/components/footer.tsx
git commit -s -m "feat(footer): expose 4 legal links + AGPL-3.0 badge + new repo URL

- Replaces ronylicha/gigapdf with QrCommunication/gigapdf
- Adds Mentions légales, Confidentialité, CGU, Cookies links
- Adds AGPL-3.0 link to LICENSE on GitHub

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 7: Externalize VPS IP from deploy scripts and docs

**Goal:** Remove hardcoded `51.159.105.179` from all tracked files. Self-hosters set their own via env vars.

**Files:**
- Modify: `deploy/push-deploy.sh`
- Modify: `deploy/redeploy.sh`
- Modify: `deploy/setup-server.sh`
- Modify: `deploy/.env.production.example`
- Modify: `docs/deployment.md`
- Modify: `docs/security/SECRETS_AUDIT_FINDINGS.md`
- Modify: `.claude/SESSION_20260423_023327_quality_audit_refactor/FINAL_REPORT.md`

- [ ] **Step 7.1: Harden push-deploy.sh**

Open `deploy/push-deploy.sh`, locate line 17:

```bash
REMOTE_HOST="${DEPLOY_HOST:-51.159.105.179}"
```

Replace with:

```bash
REMOTE_HOST="${DEPLOY_HOST:?DEPLOY_HOST is required (e.g. 'export DEPLOY_HOST=your.vps.example.com')}"
```

- [ ] **Step 7.2: Harden redeploy.sh**

Open `deploy/redeploy.sh`, locate line 31:

```bash
VPS_HOST="${GIGAPDF_VPS_HOST:-51.159.105.179}"
```

Replace with:

```bash
VPS_HOST="${GIGAPDF_VPS_HOST:?GIGAPDF_VPS_HOST is required (e.g. 'export GIGAPDF_VPS_HOST=your.vps.example.com')}"
```

- [ ] **Step 7.3: Update setup-server.sh placeholder**

Open `deploy/setup-server.sh`, locate line 234:

```bash
echo "   git remote add production ubuntu@51.159.105.179:/opt/gigapdf-repo.git"
```

Replace with:

```bash
echo "   git remote add production ubuntu@\${GIGAPDF_VPS_HOST}:/opt/gigapdf-repo.git"
```

- [ ] **Step 7.4: Update deploy/.env.production.example**

Open `deploy/.env.production.example` — append at the end:

```bash

# ─── Deployment targets (used by deploy/*.sh scripts) ───
# REQUIRED for running the deploy scripts.
DEPLOY_HOST=your.vps.example.com
GIGAPDF_VPS_HOST=your.vps.example.com
GIGAPDF_VPS_PATH=/opt/gigapdf
```

- [ ] **Step 7.5: Replace IPs in docs/deployment.md**

Run:
```bash
sed -i 's/51\.159\.105\.179/<your-vps-ip>/g' docs/deployment.md
```

Verify:
```bash
grep -c "51.159.105.179" docs/deployment.md
```
Expected: `0`.

- [ ] **Step 7.6: Replace IPs in docs/security/SECRETS_AUDIT_FINDINGS.md**

Run:
```bash
sed -i 's/51\.159\.105\.179/<your-vps-ip>/g' docs/security/SECRETS_AUDIT_FINDINGS.md
```

Verify: `grep -c "51.159.105.179" docs/security/SECRETS_AUDIT_FINDINGS.md` → `0`.

- [ ] **Step 7.7: Replace IP in .claude session report**

Run:
```bash
sed -i 's/51\.159\.105\.179/<your-vps-ip>/g' .claude/SESSION_20260423_023327_quality_audit_refactor/FINAL_REPORT.md
```

Verify total: `git grep -c "51.159.105.179"` → only matches in `.git/` (not tracked content).

- [ ] **Step 7.8: Verify no tracked file still contains the IP**

Run: `git grep "51\.159\.105\.179"`
Expected: empty output.

- [ ] **Step 7.9: Smoke-test deploy scripts (dry, no remote action)**

Run (without env var):
```bash
unset GIGAPDF_VPS_HOST DEPLOY_HOST
bash -n deploy/redeploy.sh && bash -n deploy/push-deploy.sh && bash -n deploy/setup-server.sh
```
Expected: no syntax errors.

Run (without env var, to confirm fail-fast):
```bash
unset GIGAPDF_VPS_HOST
bash deploy/redeploy.sh 2>&1 | head -3
```
Expected: error message containing "GIGAPDF_VPS_HOST is required".

- [ ] **Step 7.10: Commit**

```bash
git add deploy/push-deploy.sh deploy/redeploy.sh deploy/setup-server.sh \
        deploy/.env.production.example \
        docs/deployment.md docs/security/SECRETS_AUDIT_FINDINGS.md \
        .claude/SESSION_20260423_023327_quality_audit_refactor/FINAL_REPORT.md
git commit -s -m "chore(deploy): require GIGAPDF_VPS_HOST and DEPLOY_HOST env vars

- deploy/redeploy.sh and deploy/push-deploy.sh now fail-fast with
  a clear message if the env var is missing (no IP fallback)
- Hardcoded VPS IP (51.159.105.179) replaced by <your-vps-ip>
  placeholders in docs and the .claude session report
- deploy/.env.production.example documents the required vars

Note: the IP remains in git history (cannot be retroactively erased
without breaking forks). New forks see only env-var pattern.

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 8: Branding folder with logo assets

**Goal:** Centralize logos under CC-BY-ND 4.0, separate from the AGPLv3 code.

**Files:**
- Create: `branding/README.md`
- Create: `branding/LICENSE`
- Create: `branding/logo-icon.svg`, `branding/logo-icon-dark.svg`, `branding/logo-horizontal.svg`, `branding/logo-stacked.svg`

- [ ] **Step 8.1: Create branding folder and copy SVG assets**

Run:
```bash
mkdir -p branding
cp apps/web/public/logo-icon-dark.svg branding/logo-icon-dark.svg
# Find the lightversion in apps/web/public; if absent, use the dark one as the icon master
[ -f apps/web/public/logo-icon-light.svg ] && cp apps/web/public/logo-icon-light.svg branding/logo-icon.svg \
  || cp apps/web/public/logo-icon-dark.svg branding/logo-icon.svg
cp apps/web/public/logo-horizontal-dark.svg branding/logo-horizontal.svg
cp apps/web/public/logo-stacked-light.svg branding/logo-stacked.svg
ls branding/
```

Expected: `LICENSE` (next step), `README.md` (next step), and 4 `.svg` files.

- [ ] **Step 8.2: Download CC-BY-ND 4.0 license text**

Run:
```bash
curl -fsSL https://creativecommons.org/licenses/by-nd/4.0/legalcode.txt -o branding/LICENSE
wc -l branding/LICENSE
```
Expected: ~150 lines, file exists.

If `legalcode.txt` is not available, fall back to the deed page:
```bash
curl -fsSL "https://creativecommons.org/licenses/by-nd/4.0/legalcode.en" -o branding/LICENSE
```

- [ ] **Step 8.3: Create branding/README.md**

Create `branding/README.md`:

```markdown
# GigaPDF Branding Assets

Logos and visual assets for GigaPDF.

## License

These assets are licensed under [Creative Commons Attribution-NoDerivatives
4.0 International (CC BY-ND 4.0)](LICENSE).

You are free to:
- **Share** — copy and redistribute the material in any medium or format
- **For any purpose**, even commercially

Under the following terms:
- **Attribution** — You must give appropriate credit to QR Communication SAS,
  provide a link to the license, and indicate if changes were made.
- **NoDerivatives** — If you remix, transform, or build upon the material,
  you may not distribute the modified material.

The GigaPDF source code is licensed separately under
[GNU AGPL-3.0-or-later](../LICENSE).

## Trademark notice

"GigaPDF" and the GigaPDF logo are trademarks of QR Communication SAS.
Use of these marks is governed by [TRADEMARK.md](../TRADEMARK.md).

## Files

| File | Use case |
|------|----------|
| `logo-icon.svg` | Square icon (light background) |
| `logo-icon-dark.svg` | Square icon (dark background) |
| `logo-horizontal.svg` | Horizontal lockup (text + icon) |
| `logo-stacked.svg` | Stacked lockup (icon above text) |

## Requesting modifications

If you need a logo variant we don't provide (different aspect ratio, monochrome,
favicon at a specific size), open a GitHub Discussion or email
contact@qrcommunication.com.

We do not authorize derivative works of the logo, but we welcome requests
for additional official variants.
```

- [ ] **Step 8.4: Commit**

```bash
git add branding/
git commit -s -m "feat(branding): add branding/ folder with logo assets

- 4 SVG logo variants (icon, icon-dark, horizontal, stacked) copied
  from apps/web/public/ to a centralized branding/ folder
- branding/LICENSE: CC-BY-ND 4.0 (separate from AGPLv3 code)
- branding/README.md: usage guidelines and trademark notice

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 9: DCO workflow (GitHub Action)

**Goal:** Block PRs without `Signed-off-by:` lines on every commit.

**Files:**
- Create: `.github/workflows/dco.yml`

- [ ] **Step 9.1: Create DCO workflow**

Create `.github/workflows/dco.yml`:

```yaml
name: DCO

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: read

jobs:
  dco:
    name: Check DCO sign-off
    runs-on: ubuntu-latest
    steps:
      - name: Verify Signed-off-by on all commits
        # Pinned to commit SHA (v1.1.0 tag) to defend against tag-replay attacks
        uses: tim-actions/dco@2fd0504dc0d27b33f542867c300c60840c6dcb20
        with:
          commits: ${{ github.event.pull_request.commits_url }}
```

- [ ] **Step 9.2: Verify YAML syntax**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/dco.yml'))" && echo "OK"
```
Expected: `OK`.

If `python3-yaml` is not installed, fall back to:
```bash
node -e "const yaml=require('yaml'); yaml.parse(require('fs').readFileSync('.github/workflows/dco.yml','utf8')); console.log('OK')"
```

If neither yaml parser is available, just visually inspect the file and rely on GitHub's validation when the PR is opened.

- [ ] **Step 9.3: Commit**

```bash
git add .github/workflows/dco.yml
git commit -s -m "ci(dco): add DCO check workflow (tim-actions/dco SHA-pinned)

Every PR must have all commits signed off (git commit -s adds
'Signed-off-by:' line). Linux/Docker style, simpler than CLA.

Action pinned to commit SHA 2fd0504 (v1.1.0) per supply-chain
security best practices (after 2025 tj-actions incident).

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 10: GitHub issue and PR templates

**Goal:** Standard templates that guide contributors and disable blank issues.

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/security.md`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 10.1: Create bug report template**

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: 🐛 Bug Report
description: Report a reproducible bug
title: "[Bug] "
labels: ["bug", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug. Please fill in the
        sections below so we can reproduce and fix it quickly.

        **Security issues should NOT be reported here** — see
        [SECURITY.md](https://github.com/QrCommunication/gigapdf/blob/main/SECURITY.md).

  - type: input
    id: version
    attributes:
      label: Version / commit
      description: Output of `git rev-parse HEAD` if self-hosted, or release tag
      placeholder: "e.g. v1.0.0 or commit abc1234"
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      description: Numbered list of exact steps
      placeholder: |
        1. Open editor at /editor/abc
        2. Click "Add Text"
        3. Type "hello"
        4. ...
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Browser console / server logs
      description: Paste relevant errors. Redact any secrets.
      render: shell

  - type: dropdown
    id: environment
    attributes:
      label: Environment
      options:
        - "Cloud (giga-pdf.com)"
        - "Self-hosted (Docker)"
        - "Self-hosted (other)"
        - "Local development"
    validations:
      required: true

  - type: input
    id: browser
    attributes:
      label: Browser + version
      placeholder: "e.g. Chrome 134, Firefox 132"

  - type: checkboxes
    id: terms
    attributes:
      label: Code of Conduct
      options:
        - label: I agree to follow the [Code of Conduct](https://github.com/QrCommunication/gigapdf/blob/main/CODE_OF_CONDUCT.md)
          required: true
```

- [ ] **Step 10.2: Create feature request template**

Create `.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
name: ✨ Feature Request
description: Suggest a new feature or improvement
title: "[Feature] "
labels: ["enhancement", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting an improvement. Please fill in the sections
        below to help us evaluate and prioritize the request.

  - type: textarea
    id: problem
    attributes:
      label: Problem statement
      description: What problem are you trying to solve? Who is affected?
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      description: Describe your ideal solution. Be specific.
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: Other solutions or workarounds you've thought about

  - type: textarea
    id: context
    attributes:
      label: Additional context
      description: Mockups, links, references

  - type: checkboxes
    id: terms
    attributes:
      label: Code of Conduct
      options:
        - label: I agree to follow the [Code of Conduct](https://github.com/QrCommunication/gigapdf/blob/main/CODE_OF_CONDUCT.md)
          required: true
```

- [ ] **Step 10.3: Create security redirect template**

Create `.github/ISSUE_TEMPLATE/security.md`:

```markdown
---
name: 🔒 Security Issue
about: Do NOT use this. See SECURITY.md for the private reporting process.
title: ""
labels: []
---

# ⚠️ STOP — Do not file security issues publicly

Security vulnerabilities must be reported privately:

1. **GitHub Security Advisory** (preferred):
   https://github.com/QrCommunication/gigapdf/security/advisories/new

2. **Email**: contact@qrcommunication.com — Subject: `[Security] ...`

See [SECURITY.md](https://github.com/QrCommunication/gigapdf/blob/main/SECURITY.md)
for full reporting policy and response SLAs.

**Please close this issue and use one of the channels above.**
```

- [ ] **Step 10.4: Create config to disable blank issues**

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: 💬 Discussions
    url: https://github.com/QrCommunication/gigapdf/discussions
    about: For questions, ideas, and general discussion (not bugs)
  - name: 🔒 Report a security vulnerability
    url: https://github.com/QrCommunication/gigapdf/security/advisories/new
    about: Use the private GitHub Security Advisory flow — never file security issues publicly
```

- [ ] **Step 10.5: Create PR template**

Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
<!--
Thanks for contributing to GigaPDF!

Before opening this PR, please confirm:
- All commits are signed off (git commit -s) — see CONTRIBUTING.md → DCO
- You agree to license your contribution under AGPL-3.0-or-later
-->

## Summary

<!-- 1-3 sentences describing what this PR does and why. -->

## Type of change

- [ ] 🐛 Bug fix (non-breaking)
- [ ] ✨ New feature (non-breaking)
- [ ] 💥 Breaking change (existing behavior changes)
- [ ] 📚 Documentation only
- [ ] 🧹 Refactor / chore (no behavior change)

## How to test

<!-- Specific steps a reviewer can follow to verify the change. -->

```bash
# example commands
```

## Checklist

- [ ] Tests added/updated for new behavior
- [ ] Documentation updated (README, docs/, code comments)
- [ ] All commits signed off (`git commit -s`)
- [ ] CI passes locally (`pnpm lint && pnpm type-check && pnpm test`)
- [ ] No secrets, IPs, or personal info added
- [ ] Self-hosters' env vars documented if added (`.env.example`)

## Related issues

<!-- Closes #123, refs #456 -->
```

- [ ] **Step 10.6: Commit**

```bash
git add .github/ISSUE_TEMPLATE/ .github/PULL_REQUEST_TEMPLATE.md
git commit -s -m "chore(github): add issue and PR templates

- bug_report.yml: structured form (version, steps, expected/actual, logs, env)
- feature_request.yml: problem/solution/alternatives
- security.md: redirects to SECURITY.md (no public security issues)
- config.yml: blank_issues_enabled=false + Discussions + Security links
- PULL_REQUEST_TEMPLATE.md: DCO reminder + checklist

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 11: Update CONTRIBUTING.md (URL + DCO section)

**Goal:** Fix outdated repo URL, add DCO sign-off section.

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 11.1: Replace ronylicha/gigapdf URLs**

Run:
```bash
sed -i 's|github\.com/ronylicha/gigapdf|github.com/QrCommunication/gigapdf|g' CONTRIBUTING.md
grep -c "QrCommunication/gigapdf" CONTRIBUTING.md
```
Expected: at least `2` occurrences (one for clone, one for upstream).

- [ ] **Step 11.2: Add DCO sign-off section**

Open `CONTRIBUTING.md`. Find the section that starts with `## Quick Start` (or the section after it). Insert this **after** Quick Start and before "Ways to Contribute":

```markdown
---

## Sign your commits (DCO)

GigaPDF uses the [Developer Certificate of Origin](https://developercertificate.org)
(DCO) instead of a CLA. Every commit must be signed off:

```bash
git commit -s -m "your message"
```

This adds a `Signed-off-by: Your Name <your@email>` line, certifying that
you wrote the patch (or otherwise have the right to submit it under the
project's AGPL-3.0-or-later license).

### One-time git config

```bash
git config user.name "Your Name"
git config user.email "your@email"
```

### Forgot to sign?

Sign all commits in your branch retroactively:

```bash
git rebase --signoff main
git push --force-with-lease
```

A GitHub Action checks every commit on every PR. If a commit is not
signed off, the check fails and the PR cannot be merged.

### What you certify by signing off

> By making a contribution to this project, I certify that:
> (a) The contribution was created in whole or in part by me and I have
>     the right to submit it under the open source license indicated;
> (b) The contribution is based upon previous work that, to the best of
>     my knowledge, is covered under an appropriate open source license
>     and I have the right under that license to submit that work with
>     modifications [...];
> (c) The contribution was provided directly to me by some other person
>     who certified (a), (b) or (c) and I have not modified it.
> (d) I understand and agree that this project and the contribution are
>     public and that a record of the contribution [...] is maintained
>     indefinitely and may be redistributed [...].

Full text: https://developercertificate.org

---
```

- [ ] **Step 11.3: Add license note at the end of CONTRIBUTING.md**

Append to `CONTRIBUTING.md`:

```markdown

---

## License

By contributing, you agree that your contributions will be licensed under
the [GNU AGPL-3.0-or-later](LICENSE).
```

- [ ] **Step 11.4: Commit**

```bash
git add CONTRIBUTING.md
git commit -s -m "docs(contributing): update repo URL and add DCO sign-off section

- Replace ronylicha/gigapdf with QrCommunication/gigapdf
- Add 'Sign your commits (DCO)' section explaining git commit -s
- Add license clause: contributions are licensed under AGPL-3.0-or-later

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 12: Rewrite README.md

**Goal:** New README with AGPLv3 badge, pitch, differentiators, Cloud-vs-Self-hosted, License & Trademark section.

**Files:**
- Modify: `README.md`

- [ ] **Step 12.1: Backup current README**

Run: `cp README.md README.md.bak`

- [ ] **Step 12.2: Replace README with the new version**

Replace the entire content of `README.md` with:

```markdown
<p align="center">
  <img src="branding/logo-stacked.svg" alt="GigaPDF Logo" width="120" />
</p>

<h1 align="center">GigaPDF</h1>

<p align="center">
  <strong>The self-hostable WYSIWYG PDF editor — edit text, images and forms
  in your browser, with a complete REST API and embeddable widget.<br>
  Open source under AGPLv3.</strong>
</p>

<p align="center">
  <a href="https://github.com/QrCommunication/gigapdf/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" alt="License: AGPL-3.0-or-later" />
  </a>
  <a href="https://github.com/QrCommunication/gigapdf/blob/main/TRADEMARK.md">
    <img src="https://img.shields.io/badge/trademark-protected-orange.svg" alt="Trademark Protected" />
  </a>
  <a href="https://github.com/QrCommunication/gigapdf/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/QrCommunication/gigapdf/ci.yml?branch=main" alt="CI Status" />
  </a>
  <a href="https://github.com/QrCommunication/gigapdf/stargazers">
    <img src="https://img.shields.io/github/stars/QrCommunication/gigapdf" alt="GitHub Stars" />
  </a>
  <a href="https://giga-pdf.com">
    <img src="https://img.shields.io/badge/cloud-giga--pdf.com-green" alt="Cloud" />
  </a>
</p>

<p align="center">
  <a href="#why-gigapdf">Why GigaPDF?</a> •
  <a href="#quick-start-self-hosting">Quick Start</a> •
  <a href="#cloud-vs-self-hosting">Cloud vs Self-hosting</a> •
  <a href="#features">Features</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Why GigaPDF?

- **True WYSIWYG editing** — Edit text directly in PDFs (not just annotate),
  thanks to a Fabric.js canvas layered on top of pdfjs-dist with full font
  re-embedding for accurate output.
- **Self-hostable from day one** — `docker compose up` and you're running.
  No cloud lock-in, no telemetry, your data stays on your infrastructure.
- **API-first design** — Complete REST API (OpenAPI documented) plus an
  embeddable widget so you can integrate PDF editing into your own apps.

## Quick start (self-hosting)

```bash
git clone https://github.com/QrCommunication/gigapdf.git
cd gigapdf
cp .env.example .env             # edit values, especially LEGAL_*
cp apps/web/.env.example apps/web/.env.local
docker compose up -d
# App at http://localhost:3000
```

> ⚠️ **Self-hosters must configure `NEXT_PUBLIC_LEGAL_*` env vars** in
> `apps/web/.env.local` for LCEN compliance. The web app refuses to start in
> production mode without them. See `apps/web/.env.example`.

## Cloud vs Self-hosting

| | Cloud (giga-pdf.com) | Self-hosted |
|---|---|---|
| **Setup** | Zero config | Docker / Kubernetes |
| **Updates** | Automatic | Manual (`git pull`) |
| **Support** | Email / SLA | Community (GitHub Discussions) |
| **Cost** | Subscription | Free (your infra cost) |
| **Data residency** | EU (Scaleway, Paris) | Wherever you host |
| **Customization** | Configuration only | Full code access |

The cloud version is operated by [QR Communication SAS](https://qrcommunication.com).
The self-hosted version uses the exact same code base.

## Features

### PDF Editing
- **Visual WYSIWYG editor** — Canvas-based editing with drag-and-drop
- **Text manipulation** — Add, edit, format text with full font support
- **Images & shapes** — Insert, resize, position visual elements
- **Annotations** — Highlights, comments, stamps, freehand drawings
- **Form builder** — Create and fill interactive PDF forms

### Document operations
- Page management (add, remove, reorder, rotate)
- Merge & split documents
- Encryption & password protection
- OCR (text extraction from scans, fra+eng default)
- Conversion (HTML → PDF, URL → PDF via Playwright)

### Developer tools
- **REST API** — Complete OpenAPI spec, see `docs/api/`
- **Embed widget** — `<script src=".../embed.js">` integration
- **Webhooks** — Document lifecycle events
- **Real-time collaboration** — WebSocket-based, multiple cursors

## Architecture

GigaPDF is a pnpm + Turbo monorepo:

```
apps/
  web/        Next.js 16 frontend + API routes
  admin/      Admin dashboard
  mobile/     Expo / React Native app
packages/
  pdf-engine/ TypeScript PDF processing (pdfjs-dist + pdf-lib + Playwright)
  canvas/     Fabric.js editor canvas
  editor/     React editor components
  embed/      Embeddable widget
  billing/    Stripe integration (optional)
  api/        TypeScript API client
  ui/         Shared UI components (shadcn-based)
  ...
```

See [`docs/architecture.md`](docs/architecture.md) for details.

## Contributing

Contributions are welcome! Please:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md)
2. Sign your commits with DCO: `git commit -s` (every commit, no exceptions)
3. Read the [Code of Conduct](CODE_OF_CONDUCT.md)

## Security

Found a vulnerability? **Do not open a public issue.** See [SECURITY.md](SECURITY.md)
for the private reporting process (GitHub Security Advisory or
contact@qrcommunication.com).

## License & Trademark

GigaPDF has **two distinct licensing regimes**:

### Code: GNU AGPL-3.0-or-later

The source code is licensed under [AGPL-3.0-or-later](LICENSE). Any modified
version used to provide a network service must publish its source code.

### Name & logo: Trademarks of QR Communication SAS

The "GigaPDF" name and logo are trademarks of **QR Communication SAS**.
**Forks with code modifications must rebrand entirely** (different name,
different logo, different domain). See [TRADEMARK.md](TRADEMARK.md) for
details. Logo assets are in [`branding/`](branding/) under
[CC-BY-ND 4.0](branding/LICENSE).

## About

GigaPDF is built and maintained by [QR Communication](https://qrcommunication.com),
a Paris-based company.

- 🌐 **Cloud version**: https://giga-pdf.com
- 💬 **Discussions**: https://github.com/QrCommunication/gigapdf/discussions
- 📧 **Contact**: contact@qrcommunication.com
- 🐛 **Issues**: https://github.com/QrCommunication/gigapdf/issues
```

- [ ] **Step 12.3: Verify badges work**

Visually inspect the README. The badges are shields.io URLs that resolve when GitHub renders the page; can't be unit-tested locally. Confirm:
- License badge points to `LICENSE` file
- All `ronylicha/gigapdf` URLs are now `QrCommunication/gigapdf`
- Logo path is `branding/logo-stacked.svg` (file exists from Task 8)

Run: `grep -c "ronylicha/gigapdf" README.md`
Expected: `0`.

Run: `grep -c "QrCommunication/gigapdf" README.md`
Expected: at least `8`.

- [ ] **Step 12.4: Remove backup**

Run: `rm README.md.bak`

- [ ] **Step 12.5: Commit**

```bash
git add README.md
git commit -s -m "docs(readme): rewrite for AGPLv3, trademark, cloud-vs-selfhosted

- Replace MIT badge with AGPL-3.0-or-later (correct license)
- Add trademark badge linking to TRADEMARK.md
- New pitch: 'self-hostable WYSIWYG PDF editor' + 3 differentiators
- Cloud vs Self-hosting comparison table
- Updated all GitHub URLs (ronylicha → QrCommunication)
- Add 'License & Trademark' section explaining the dual regime
  (AGPLv3 code + trademark-protected name/logo)
- Add 'About' section with QR Communication contact

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 13: CHANGELOG entry + docs/oss/README.md

**Goal:** Document the release and provide an OSS docs entry point.

**Files:**
- Create or modify: `CHANGELOG.md`
- Create: `docs/oss/README.md`

- [ ] **Step 13.1: Create or update CHANGELOG.md**

If `CHANGELOG.md` does not exist, create it with the full content below. If it exists, prepend a new section.

Run: `[ -f CHANGELOG.md ] && echo "exists" || echo "create"`

If "create":

```markdown
# Changelog

All notable changes to GigaPDF are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-oss] — 2026-04-26

### Added
- `LICENSE` (GNU AGPL-3.0-or-later) — the project is now officially
  open source. The previous README announced "MIT" but no LICENSE
  was published, leaving the code in a "all rights reserved" state.
- `TRADEMARK.md` — strict trademark policy: forks with code modifications
  must rebrand entirely. Hosting an unmodified copy is allowed with
  disclaimer. Logo CC-BY-ND 4.0.
- `SECURITY.md` — vulnerability reporting via GitHub Security Advisories
  or contact@qrcommunication.com, with response SLAs per severity.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `.github/workflows/dco.yml` — DCO check on every PR. All commits must
  be signed off (`git commit -s`).
- `.github/ISSUE_TEMPLATE/` — bug, feature, and security templates.
  Blank issues disabled.
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist with DCO reminder.
- `branding/` folder — 4 SVG logo variants under CC-BY-ND 4.0.
- 4 separate legal pages: `/legal-notice`, `/privacy`, `/terms`,
  `/cookies`. Personal email replaced by `contact@qrcommunication.com`.
- `apps/web/src/lib/env.ts` — Zod-validated public legal env vars.
  Production refuses to start without them.

### Changed
- `README.md` — full rewrite: AGPLv3 + trademark badges, new pitch,
  3 differentiators, Cloud vs Self-hosted comparison, License &
  Trademark section, About QR Communication.
- `CONTRIBUTING.md` — repo URL updated (ronylicha → QrCommunication),
  DCO sign-off section added, license clause added.
- All 17 `package.json` files declare `"license": "AGPL-3.0-or-later"`
  per SPDX.
- Hardcoded VPS IP (`51.159.105.179`) removed from deploy scripts and
  docs. `deploy/redeploy.sh` and `deploy/push-deploy.sh` now require
  `GIGAPDF_VPS_HOST` / `DEPLOY_HOST` and fail-fast if missing.
- Hardcoded personal email (`rony@ronylicha.net`) removed from privacy
  and terms pages. Now sourced from `env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`.

### Notes for self-hosters
- You **must** configure `NEXT_PUBLIC_LEGAL_*` env vars in
  `apps/web/.env.local` to comply with French LCEN. The app refuses
  to start in production without them. See `apps/web/.env.example`.
- For deploy scripts: `export GIGAPDF_VPS_HOST=your.host.example.com`
  before running `deploy/redeploy.sh`.

### Links
- AGPLv3 text: https://www.gnu.org/licenses/agpl-3.0.txt
- Trademark policy: [TRADEMARK.md](TRADEMARK.md)
- Logo assets: [branding/](branding/)
```

If "exists" (CHANGELOG.md already present), open it and prepend the `## [1.0.0-oss]` section right after the title and intro paragraphs.

- [ ] **Step 13.2: Create docs/oss/README.md**

Create `docs/oss/README.md`:

```markdown
# Open Source Documentation

This folder contains documentation for contributors and self-hosters of
the open-source GigaPDF project.

## Quick links

- 📜 [LICENSE](../../LICENSE) — GNU AGPL-3.0-or-later
- ™️ [TRADEMARK.md](../../TRADEMARK.md) — Trademark policy
- 🔒 [SECURITY.md](../../SECURITY.md) — Vulnerability reporting
- 📋 [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- 🤝 [CONTRIBUTING.md](../../CONTRIBUTING.md) — How to contribute
- 🎨 [branding/](../../branding/) — Logo assets (CC-BY-ND 4.0)
- 📝 [CHANGELOG.md](../../CHANGELOG.md) — Release notes

## FAQ

### Why AGPL-3.0-or-later?

We chose AGPL because GigaPDF is primarily a network service (SaaS).
AGPL ensures that any modified version used to provide a network service
must publish its source code, so improvements made by hosting providers
are contributed back to the community.

If you only run the code privately or for internal use, AGPL feels exactly
like a permissive license — the obligation to share modifications only
kicks in when you offer the modified version as a service.

### Can I use the GigaPDF code in my company?

Yes, as long as you respect the AGPL terms. If you're modifying the code
and offering the modified version as a service to anyone (including your
own employees in some jurisdictions), you must publish the modifications
under AGPL.

If you have doubts, please consult a lawyer or contact us at
contact@qrcommunication.com.

### Can I use the GigaPDF name and logo?

The code is open. The name and logo are trademarks. **Forks with code
modifications must rebrand**. See [TRADEMARK.md](../../TRADEMARK.md).

### Why DCO instead of CLA?

DCO (Developer Certificate of Origin) is simpler than a CLA (Contributor
License Agreement). It's a per-commit attestation (the `Signed-off-by:`
line added by `git commit -s`). Linux, Docker, GitLab and many large
projects use DCO. We follow that convention.

### How do I report a bug?

Use the [bug report template](https://github.com/QrCommunication/gigapdf/issues/new/choose).
For security issues, see [SECURITY.md](../../SECURITY.md).

### How do I propose a feature?

Use the [feature request template](https://github.com/QrCommunication/gigapdf/issues/new/choose).
For bigger discussions, use [GitHub Discussions](https://github.com/QrCommunication/gigapdf/discussions).

### Will you accept my PR?

We welcome PRs but cannot promise to merge every contribution. Bug fixes
with tests are typically merged quickly. New features may need design
discussion before code is written — please open an issue first to align
on the approach.

All PRs must:
- Have all commits signed off (`git commit -s`)
- Pass CI (lint, type-check, tests)
- Include tests for new behavior
- Update documentation if user-visible

## Code of Conduct

We follow the [Contributor Covenant 2.1](../../CODE_OF_CONDUCT.md).
Be respectful, constructive, and focused on what's best for the community.
```

- [ ] **Step 13.3: Commit**

```bash
git add CHANGELOG.md docs/oss/README.md
git commit -s -m "docs(changelog): add v1.0.0-oss release notes and OSS docs index

CHANGELOG.md: full v1.0.0-oss entry documenting LICENSE addition,
trademark policy, OSS community files, env var refactoring, and
breaking changes for self-hosters (NEXT_PUBLIC_LEGAL_* required).

docs/oss/README.md: Quick links + FAQ (why AGPL, why DCO, how to
contribute, trademark questions).

Refs: docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md"
```

---

## Task 14: Final verification & PR

**Goal:** Local CI passes, no leftover personal info, branch ready to push.

- [ ] **Step 14.1: Lint & type check**

Run: `pnpm turbo run lint type-check --filter=web --filter=admin 2>&1 | tail -20`
Expected: success (no errors).

If lint complains about new files, fix and amend.

- [ ] **Step 14.2: Run tests**

Run: `pnpm --filter web test 2>&1 | tail -20`
Expected: all tests pass, including the 5 new env tests from Task 4.

- [ ] **Step 14.3: Build verification**

Run: `pnpm --filter web build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 14.4: Search for any remaining personal info**

Run:
```bash
git grep -nE "rony@ronylicha\.net|ronylicha\.net|Rony Licha" -- ':!*.bak' ':!.git/*'
```
Expected: empty output, OR only matches in spec/plan files in `docs/superpowers/` (the spec deliberately mentions the old email as the thing being removed).

- [ ] **Step 14.5: Search for hardcoded VPS IP**

Run: `git grep -n "51\.159\.105\.179"`
Expected: empty output.

- [ ] **Step 14.6: Verify all 13 task commits are present and signed off**

Run: `git log --pretty='%h %s' main..HEAD | wc -l`
Expected: 13 (one commit per task; minor variation OK).

Run: `git log --format="%(trailers:key=Signed-off-by)" main..HEAD | grep -c "Signed-off-by:"`
Expected: 13 (all commits signed off).

If any commit is missing the sign-off:
```bash
git rebase --signoff main
```

- [ ] **Step 14.7: Push branch**

Run:
```bash
git push -u origin chore/oss-trademark-clarification
```

- [ ] **Step 14.8: Open the PR**

Run:
```bash
gh pr create \
  --title "chore: clarify AGPL-3.0-or-later licensing and protect GigaPDF trademark" \
  --body "$(cat <<'EOF'
## Summary

This PR officially licenses GigaPDF under **GNU AGPL-3.0-or-later**, adds the
**TRADEMARK.md** policy protecting the "GigaPDF" name/logo, removes hardcoded
personal/infrastructure data from public files, and adds the standard OSS
community files (SECURITY, Code of Conduct, DCO workflow, GitHub templates).

## Why

The repository was already public, but the README announced "MIT" without a
LICENSE file. Legally, this means "all rights reserved" — the code was
visible but not legally usable. This PR resolves that ambiguity.

The choice of AGPLv3 ensures that improvements made by SaaS operators are
contributed back to the community (the project's stated goal).

## Spec & Plan

- Design: `docs/superpowers/specs/2026-04-26-oss-trademark-clarification-design.md`
- Plan: `docs/superpowers/plans/2026-04-26-oss-trademark-clarification.md`

## Highlights

- **LICENSE**: GNU AGPL-3.0-or-later (verbatim from gnu.org)
- **TRADEMARK.md**: strict policy — forks with modifications must rebrand
- **DCO**: every PR must have all commits signed off (`git commit -s`)
- **Legal pages**: 4 separate (mentions, privacy, terms, cookies), sourced
  from `env.NEXT_PUBLIC_LEGAL_*` (Zod-validated, prod crashes if missing)
- **Externalization**: hardcoded VPS IP and personal email removed
- **Branding**: `branding/` folder with logos under CC-BY-ND 4.0

## Breaking changes for self-hosters

Self-hosters **must** now configure `NEXT_PUBLIC_LEGAL_*` env vars (LCEN
compliance). The web app refuses to start in production without them.

Deploy scripts now require `GIGAPDF_VPS_HOST` and `DEPLOY_HOST` env vars
(no IP fallback). See `deploy/.env.production.example`.

## Test plan

- [x] `pnpm test` passes (5 new env validation tests)
- [x] `pnpm lint` passes
- [x] `pnpm type-check` passes
- [x] `pnpm build` succeeds
- [x] Visual smoke test on /legal-notice, /privacy, /terms, /cookies
- [x] No tracked file contains 51.159.105.179 or rony@ronylicha.net
- [x] All 13 commits signed off (DCO check will confirm on this PR)

## Companion actions (not in this PR)

- INPI trademark filing (action by @ronylicha — not blocking the merge)
- Public announcement (J+0 GitHub Release, J+1 Reddit, J+2 HN, J+3 LinkedIn)
EOF
)"
```

- [ ] **Step 14.9: Verify CI starts on the PR**

Run: `gh pr checks --watch` (or open the PR URL in a browser)
Expected: DCO action passes (all 13 commits signed off), other CI jobs run normally.

If DCO fails, run `git rebase --signoff main && git push --force-with-lease` and re-check.

---

## Self-Review Notes

The plan has been reviewed against the spec. Coverage matrix:

| Spec section | Plan task |
|--------------|-----------|
| §5.1 Files to create #1 (LICENSE) | Task 1 |
| §5.1 Files to create #2 (TRADEMARK.md) | Task 2 |
| §5.1 Files to create #3 (SECURITY.md) | Task 3 |
| §5.1 Files to create #4 (CODE_OF_CONDUCT.md) | Task 3 |
| §5.1 Files to create #5-9 (GitHub templates) | Task 10 |
| §5.1 Files to create #10 (DCO workflow) | Task 9 |
| §5.1 Files to create #11 (lib/env.ts) | Task 4 |
| §5.1 Files to create #12 (legal-notice page) | Task 5 |
| §5.1 Files to create #13 (cookies page) | Task 5 |
| §5.1 Files to create #14-19 (branding/) | Task 8 |
| §5.1 Files to create #20 (CHANGELOG entry) | Task 13 |
| §5.1 Files to create #21 (docs/oss/README.md) | Task 13 |
| §5.2 license fields × 17 | Task 1 |
| §5.2 Code refactoring (privacy, terms, footer, env.example) | Tasks 4, 5, 6 |
| §5.2 deploy scripts hardening | Task 7 |
| §5.2 docs IPs replacement | Task 7 |
| §5.2 README rewrite | Task 12 |
| §5.2 CONTRIBUTING update | Task 11 |

**No spec section is unimplemented.**

**Type consistency:** `env.NEXT_PUBLIC_LEGAL_*` keys are defined identically in Task 4 (Zod schema), Task 4.8 (.env.example), and Tasks 5.1/5.2/5.3/5.5 (consumption in TSX). Spelling and casing match across tasks.

**Placeholder scan:** The remaining `<DATE>`, `<N°>`, `<your-vps-ip>` values are intentional placeholders that will be filled at runtime (INPI filing date, application number) or by self-hosters. They are not "TODO" markers in the plan itself — every plan step has actual content.
