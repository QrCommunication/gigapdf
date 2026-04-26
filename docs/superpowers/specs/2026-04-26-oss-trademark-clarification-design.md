# Design — Clarification OSS & protection de marque GigaPDF

**Date** : 2026-04-26
**Auteur** : Rony Licha (QR Communication SAS)
**Statut** : Validé, prêt pour implémentation
**Approche** : A — Big bang (un seul PR consolidé)

---

## 1. Contexte & problème

Le repository `github.com/QrCommunication/gigapdf` est **déjà public**, son README annonce une licence MIT, mais **aucun fichier `LICENSE` n'a jamais été publié**. En droit d'auteur, l'absence de licence explicite signifie "tous droits réservés" — la situation actuelle est donc juridiquement incohérente : le code est *visible* mais légalement *non utilisable*.

Par ailleurs, des éléments d'infrastructure (IP du VPS Scaleway, email personnel) sont hardcodés dans des fichiers trackés par git, et plusieurs documents requis pour un projet OSS communautaire (TRADEMARK.md, SECURITY.md, CODE_OF_CONDUCT.md, templates GitHub, workflow DCO) sont absents.

**Objectif** : régulariser la situation en publiant officiellement GigaPDF sous **GNU AGPL-3.0-or-later**, tout en protégeant la **marque "GigaPDF"** par un dépôt INPI parallèle, le tout en un seul PR consolidé.

## 2. Décisions clés (validées avec l'utilisateur)

| # | Décision | Valeur retenue |
|---|----------|----------------|
| D1 | Modèle | Full open source (pas open-core) |
| D2 | Licence code | **GNU AGPL-3.0-or-later** sur l'ensemble du monorepo |
| D3 | Licence logo | CC-BY-ND 4.0 |
| D4 | Owner GitHub | `QrCommunication` (pas `ronylicha`) |
| D5 | Approche d'exécution | A — Big bang, un seul PR |
| D6 | Modèle de contribution | DCO mode strict (tous commits signés `Signed-off-by:`) |
| D7 | Politique de marque | **Strict** (Mozilla-style) — rebranding obligatoire pour les forks modifiés. Hosting commercial inchangé autorisé avec disclaimer. |
| D8 | Pages légales | 4 pages séparées (mentions, privacy, terms, cookies) avec header/footer DRY |
| D9 | Conservation données | Pendant durée du compte, suppression sur demande (formule CNIL) |
| D10 | Sous-traitants RGPD | Scaleway (actuel) + Stripe + Google OAuth (mentionnés comme activables) |
| D11 | Directeur de publication | "Le Président de QR Communication SAS" (formule générique) |
| D12 | Contact unique | `contact@qrcommunication.com` (pas d'alias dédiés) |
| D13 | Hébergeur LCEN | Scaleway uniquement (mise à jour le jour où Hetzner part en prod) |
| D14 | Validation env vars légales | Mode strict (vide par défaut + warning console) |
| D15 | Dépôt marque | INPI classes 9 + 42 + 38 (~270€ HT). EUIPO différé. |

## 3. Identité juridique QR Communication

À utiliser dans toutes les pages légales et fichiers requis.

```
Raison sociale     : QR Communication
Forme juridique    : Société par Actions Simplifiée (SAS)
SIREN              : 940 163 496
Code APE           : 73.12Z (Régie publicitaire de médias)
Siège social       : 23 rue de Richelieu, 75001 Paris, France
Téléphone          : +33 1 88 83 34 51
Email              : contact@qrcommunication.com
Directeur publi.   : Le Président de QR Communication SAS
Hébergeur          : Scaleway SAS, 8 rue de la Ville l'Évêque, 75008 Paris
```

## 4. Architecture du chantier

```
PISTE LÉGALE                PISTE CODE                 PISTE COMMUNICATION
────────────                ──────────                 ──────────────────
LICENSE (AGPLv3)            lib/env.ts (Zod strict)    README v2 (rewrite)
TRADEMARK.md                IP VPS → env var           CHANGELOG entry
SECURITY.md                 Email perso → env var      Annonce J+1...J+3
CODE_OF_CONDUCT.md          .gitignore review          Templates GitHub
4 pages légales             DCO workflow               (issues + PR)
license fields × 17         branding/ folder

Dépôt INPI parallèle
(action utilisateur,
non bloquant pour le PR)
```

Toutes les pistes convergent vers un seul PR mergé en une fois.

## 5. Inventaire exhaustif des fichiers

### 5.1 Fichiers à CRÉER

| # | Path | Description |
|---|------|-------------|
| 1 | `LICENSE` | Texte AGPLv3 verbatim depuis gnu.org/licenses/agpl-3.0.txt (~34 KB, ne pas modifier) |
| 2 | `TRADEMARK.md` | Politique strict : rebranding obligatoire forks, hosting OK avec disclaimer, logo CC-BY-ND 4.0 |
| 3 | `SECURITY.md` | Reporting via contact@qrcommunication.com, GitHub Security Advisories, SLA 7j |
| 4 | `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 verbatim, contact@qrcommunication.com |
| 5 | `.github/ISSUE_TEMPLATE/bug_report.yml` | Form-based YAML, champs : versions, étapes reproduction, logs |
| 6 | `.github/ISSUE_TEMPLATE/feature_request.yml` | Form-based YAML, champs : problème, solution proposée, alternatives |
| 7 | `.github/ISSUE_TEMPLATE/security.md` | Renvoie vers SECURITY.md, désactive issue publique |
| 8 | `.github/ISSUE_TEMPLATE/config.yml` | `blank_issues_enabled: false` + lien GitHub Discussions |
| 9 | `.github/PULL_REQUEST_TEMPLATE.md` | Checklist : DCO signed, tests, docs, breaking changes |
| 10 | `.github/workflows/dco.yml` | `tim-actions/dco@2fd0504...` SHA-pinné, mode strict (tous commits) |
| 11 | `apps/web/src/lib/env.ts` | Validation Zod strict, NEXT_PUBLIC_LEGAL_*, warnings si non-config |
| 12 | `apps/web/src/app/(legal)/legal-notice/page.tsx` | Mentions légales LCEN — QR Communication + Scaleway |
| 13 | `apps/web/src/app/(legal)/cookies/page.tsx` | Politique cookies (better-auth uniquement, pas de bannière) |
| 14 | `branding/README.md` | Index des assets logo, licence CC-BY-ND 4.0, usage |
| 15 | `branding/logo-icon.svg` | Copie de `apps/web/public/logo-icon-dark.svg` |
| 16 | `branding/logo-horizontal.svg` | Copie de `apps/web/public/logo-horizontal-dark.svg` |
| 17 | `branding/logo-stacked.svg` | Copie de `apps/web/public/logo-stacked-light.svg` |
| 18 | `branding/logo-icon-dark.svg` | Copie variante sombre |
| 19 | `branding/LICENSE` | Texte CC-BY-ND 4.0 (https://creativecommons.org/licenses/by-nd/4.0/legalcode) |
| 20 | `CHANGELOG.md` (entrée v1.0.0-oss) | Description du passage AGPLv3 + raisons + breaking changes documentaires |
| 21 | `docs/oss/README.md` | Index des docs OSS : licence, contribuer, gouvernance, FAQ |

### 5.2 Fichiers à MODIFIER

#### License fields (17 fichiers)

Ajouter `"license": "AGPL-3.0-or-later"` dans :

| Path |
|------|
| `package.json` (racine) — ajouter aussi `author`, `homepage`, `repository`, `bugs` |
| `apps/web/package.json` |
| `apps/admin/package.json` |
| `apps/mobile/package.json` |
| `packages/api/package.json` |
| `packages/billing/package.json` |
| `packages/canvas/package.json` |
| `packages/editor/package.json` |
| `packages/embed/package.json` |
| `packages/eslint-config/package.json` |
| `packages/logger/package.json` |
| `packages/pdf-engine/package.json` |
| `packages/s3/package.json` |
| `packages/tailwind-config/package.json` |
| `packages/typescript-config/package.json` |
| `packages/types/package.json` |
| `packages/ui/package.json` |

#### Code (externalisation IP/email)

| Path | Modification |
|------|--------------|
| `apps/web/src/app/(legal)/privacy/page.tsx` | Réécriture complète RGPD-conforme avec `env.NEXT_PUBLIC_LEGAL_*` |
| `apps/web/src/app/(legal)/terms/page.tsx` | Réécriture complète CGU avec QR Communication + AGPLv3 |
| `apps/web/src/components/footer.tsx` | Exposer 4 liens légaux + GitHub icon + badge AGPLv3 |
| `apps/web/.env.example` | + variables `NEXT_PUBLIC_LEGAL_*` documentées |
| `apps/admin/.env.example` | + idem (si pages légales admin nécessaires — sinon skip) |
| `deploy/push-deploy.sh` (ligne 17) | `REMOTE_HOST="${DEPLOY_HOST:?DEPLOY_HOST is required}"` |
| `deploy/redeploy.sh` (ligne 31) | `VPS_HOST="${GIGAPDF_VPS_HOST:?GIGAPDF_VPS_HOST is required}"` |
| `deploy/setup-server.sh` (ligne 234) | `echo "git remote add production ubuntu@<YOUR_VPS_IP>:/opt/gigapdf-repo.git"` |
| `deploy/.env.production.example` | + `DEPLOY_HOST=`, `GIGAPDF_VPS_HOST=` documentés |
| `docs/deployment.md` (4 occurrences) | IP `51.159.105.179` → `<your-vps-ip>` |
| `docs/security/SECRETS_AUDIT_FINDINGS.md` (2 occ.) | IP → `<your-vps-ip>` ou marquer "exemple historique" |
| `.claude/SESSION_20260423_023327_quality_audit_refactor/FINAL_REPORT.md` | IP → placeholder ou retirer la ligne |
| `.gitignore` | Vérifier présence patterns : `*.png` racine debug, `.local/`, `.claude/SESSION_*` (selon préférence) |

#### Documentation / Communication

| Path | Modification |
|------|--------------|
| `README.md` | **Réécriture complète** : badge AGPLv3, pitch 1 phrase, 3 différenciateurs, Cloud vs Self-hosted, sections License & Trademark, About QR Communication |
| `CONTRIBUTING.md` | Mise à jour URL repo (ronylicha → QrCommunication), ajout section DCO sign-off, mention AGPLv3 implications |

### 5.3 Fichiers à NETTOYER (locaux uniquement)

| Path | Action |
|------|--------|
| `*.png` à la racine du projet (12 screenshots de debug) | `rm` ou déplacer vers `.local/` (gitignored) |
| `.claude/SESSION_20260421_*`, `SESSION_20260422_*`, `SESSION_20260423_*` non trackés | Vérifier qu'ils sont en `.gitignore` |

## 6. Détails techniques

### 6.1 lib/env.ts (Zod strict)

`apps/web/src/lib/env.ts` :

```typescript
import { z } from "zod";

const isProduction = process.env.NODE_ENV === "production"
  && process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:3000";

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

const raw = {
  NEXT_PUBLIC_LEGAL_COMPANY_NAME: process.env.NEXT_PUBLIC_LEGAL_COMPANY_NAME ?? "",
  // … toutes les variables avec fallback ""
};

const result = legalSchema.safeParse(raw);

if (!result.success) {
  if (isProduction) {
    throw new Error(
      "Legal env vars are missing in production. " +
      "Self-hosters must configure NEXT_PUBLIC_LEGAL_* per LCEN. " +
      "See README.md → Self-hosting."
    );
  } else {
    console.warn(
      "[gigapdf] Legal env vars not configured. " +
      "Legal pages will show empty values. " +
      "This is OK for local dev, NOT OK for production."
    );
  }
}

export const env = result.success ? result.data : (raw as z.infer<typeof legalSchema>);
```

**Comportement** :
- Dev local sans config → warning console, valeurs vides dans pages légales (UX OK pour test).
- Production sans config → l'app crash au démarrage avec message explicite renvoyant vers la doc.
- Production configurée → tout fonctionne normalement avec les valeurs du fork.

### 6.2 TRADEMARK.md (modèle strict)

Structure complète :

```markdown
# Trademark Policy — GigaPDF

The GigaPDF source code is open source under the GNU AGPL-3.0-or-later license.

The "**GigaPDF**" name and logo are trademarks of **QR Communication SAS**
(SIREN 940 163 496, 23 rue de Richelieu, 75001 Paris, France),
filed with the French INPI on <DATE>, application number **<N°>**.

This policy explains acceptable and unacceptable uses of the trademark
to protect users from confusion and the project from misrepresentation.

## ✅ Allowed without permission

- Refer to GigaPDF in articles, blog posts, books, talks, tutorials
- Indicate compatibility ("plugin for GigaPDF", "GigaPDF-compatible")
- Run an unmodified copy of GigaPDF for personal or internal use
- Host an unmodified copy as a service for end users, **provided the
  service page clearly states**:
  > "Hosted GigaPDF service operated by [Your Company]. Not affiliated
  > with QR Communication SAS or the official GigaPDF project."

## ❌ Not allowed without written permission

- Distributing a **modified version** under the name "GigaPDF" or any
  confusingly similar name. **Forks must rebrand entirely** (different
  primary name, different logo, different domain). The fork README may
  state "based on GigaPDF v<x.y.z>".
- Using the GigaPDF logo on commercial materials suggesting endorsement
- Domain names containing "gigapdf" suggesting official affiliation
  (e.g., gigapdf-pro.com, official-gigapdf.io, gigapdfhosting.com)
- Selling merchandise bearing the GigaPDF name or logo
- Registering "GigaPDF" or similar as a trademark in any jurisdiction

## 📧 Permission requests

Send to: **contact@qrcommunication.com**

Subject line: `[Trademark] Your request`. Typical response time: 7 days.

## Logo assets

Available at https://github.com/QrCommunication/gigapdf/tree/main/branding
under **CC-BY-ND 4.0** (attribution required, no derivative works).

The code remains AGPLv3.

## Contact

QR Communication SAS
23 rue de Richelieu, 75001 Paris, France
contact@qrcommunication.com — +33 1 88 83 34 51
```

### 6.3 DCO workflow

`.github/workflows/dco.yml` :

```yaml
name: DCO

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: read

jobs:
  dco:
    runs-on: ubuntu-latest
    steps:
      - name: Check DCO sign-off on all commits
        uses: tim-actions/dco@2fd0504dc0d27b33f542867c300c60840c6dcb20
        with:
          commits: ${{ github.event.pull_request.commits_url }}
```

### 6.4 Pages légales — contenu détaillé

#### Mentions légales (`/legal-notice`)

Sections obligatoires LCEN art. 6-III :
1. Éditeur (raison sociale, forme, SIREN, APE, adresse, téléphone, email, directeur publication)
2. Hébergeur (Scaleway SAS — nom, adresse, téléphone)
3. Propriété intellectuelle (code AGPLv3 + nom/logo marques)
4. Contact

#### Politique de confidentialité (`/privacy`)

Sections RGPD :
1. Responsable du traitement
2. Données collectées (compte, OAuth, PDFs, logs, cookies)
3. Finalités
4. Base légale
5. Durées de conservation (durée du compte + suppression sur demande)
6. Sous-traitants (Scaleway actif, Stripe + Google activables)
7. Droits RGPD (accès, rectification, effacement, portabilité, opposition, limitation)
8. Transferts hors UE (aucun par défaut)
9. CNIL (réclamation)
10. Contact DPO

#### CGU (`/terms`)

10 sections : Objet, Compte, Usage, Contenu utilisateur, Disponibilité, Responsabilité, OSS, Modifications, Droit applicable, Contact.

#### Cookies (`/cookies`)

Tableau des 3 cookies strictement nécessaires (better-auth.session_token, better-auth.csrf_token, NEXT_LOCALE), justification absence bannière (CNIL 2020), désactivation, contact.

### 6.5 README v2 — squelette

```markdown
<p align="center">
  <img src="branding/logo-stacked.svg" width="120" />
</p>

<h1 align="center">GigaPDF</h1>

<p align="center">
  <strong>The self-hostable WYSIWYG PDF editor — edit text, images
  and forms in your browser, with a complete REST API and embeddable
  widget. Open source under AGPLv3.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" /></a>
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/trademark-protected-orange.svg" /></a>
  ... [autres badges]
</p>

[Screenshot ou GIF]

## Why GigaPDF?

- **True WYSIWYG editing** — Edit text directly in PDFs (not just annotate)
  thanks to a Fabric.js canvas layered on pdfjs-dist
- **Self-hostable from day one** — Docker compose, no cloud lock-in,
  your data stays on your infrastructure
- **API-first design** — REST API + embeddable widget to integrate
  PDF editing into your own apps

## Quick start (self-hosting)
[bloc bash]

## Cloud vs Self-hosting
[tableau comparatif]

## Features
[liste raccourcie]

## Architecture
[diagramme léger ou lien]

## Contributing
PRs welcome with [DCO sign-off](CONTRIBUTING.md#sign-your-commits-dco).

## Security
See [SECURITY.md](SECURITY.md).

## License & Trademark
- **Code**: GNU AGPLv3 ([LICENSE](LICENSE))
- **"GigaPDF" name and logo**: Trademarks of QR Communication SAS
  (see [TRADEMARK.md](TRADEMARK.md)). Forks must rebrand entirely.

## About
Built by [QR Communication](https://qrcommunication.com) in Paris, France.
```

## 7. Plan INPI (parallèle, action utilisateur)

| Étape | Action | Délai | Coût |
|-------|--------|-------|------|
| 1 | Recherche antériorité sur https://data.inpi.fr/recherche_avancee/marques | 15 min | gratuit |
| 2 | Création compte INPI sur https://procedures.inpi.fr | 10 min | gratuit |
| 3 | Dépôt en ligne — classes 9 (logiciels) + 42 (services info) + 38 (télécoms) | 30 min | 270€ HT |
| 4 | Réception du n° de dépôt INPI | immédiat | — |
| 5 | Mise à jour TRADEMARK.md avec le n° de dépôt | 2 min | — |
| 6 | Publication BOPI | ~6 semaines | — |
| 7 | Période d'opposition tiers | 2 mois | — |
| 8 | Enregistrement définitif (™ → ®) | ~4 mois après dépôt | — |

**EUIPO** (Europe entière) : différé. Coût ~850€, à activer quand visibilité européenne justifie.

## 8. Plan de communication

### 8.1 Séquence d'annonce

| Jour | Canal | Format |
|------|-------|--------|
| J+0 | GitHub Release v1.0.0-oss | Tag + release notes (= CHANGELOG entry) |
| J+1 matin (heure Paris) | Reddit r/selfhosted | Titre factuel, démo + lien repo |
| J+1 après-midi | Reddit r/opensource | Focus AGPLv3 + gouvernance |
| J+2 mardi/jeudi 14h Paris | Hacker News Show HN | Titre `Show HN: GigaPDF – Open source WYSIWYG PDF editor (AGPLv3)` |
| J+3 | LinkedIn QR Communication | Post entreprise, ton neutre |

### 8.2 Règles d'engagement

- HN : auteur dispo 1h+ pour répondre, pas de jargon marketing, premier commentaire par toi avec démo
- Reddit : pas de lien dans le titre, démo claire dans le post, réponse à toutes les questions techniques
- LinkedIn : pas de copy LinkedIn-style ("excited to announce"), factuel
- **Twitter/X exclu** : ROI faible sans audience établie, risque bruit

### 8.3 CHANGELOG entry (v1.0.0-oss)

```markdown
## [1.0.0-oss] — 2026-MM-DD

### Added
- `LICENSE` (GNU AGPL-3.0-or-later) — the project is now officially open source.
- `TRADEMARK.md` — "GigaPDF" name and logo are trademarks of QR Communication SAS.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, GitHub issue/PR templates.
- DCO workflow (`tim-actions/dco`) — all commits must be signed off.
- `branding/` folder with logo assets under CC-BY-ND 4.0.
- 4 separate legal pages (legal notice, privacy, terms, cookies) with QR
  Communication SAS information.
- `apps/web/src/lib/env.ts` — Zod-validated env vars for legal information,
  enabling clean self-hosting.

### Changed
- README rewritten: AGPLv3 badge, cloud-vs-self-hosted comparison,
  trademark notice, About QR Communication section.
- `CONTRIBUTING.md` updated: GitHub URL, DCO sign-off section.
- Hardcoded VPS IP and personal email removed from deploy scripts and
  legal pages, replaced by required env vars (`GIGAPDF_VPS_HOST`,
  `NEXT_PUBLIC_LEGAL_*`).
- `package.json` (root + 16 workspaces) now declares
  `"license": "AGPL-3.0-or-later"` per SPDX standards.

### Notes for self-hosters
You **must** configure `NEXT_PUBLIC_LEGAL_*` env vars to comply with
French LCEN. The app will refuse to start in production without them.
See `apps/web/.env.example`.
```

## 9. Stratégie de PR

**Branche** : `chore/oss-trademark-clarification`

**Ordre des commits** (un seul PR, plusieurs commits pour reviewabilité) :

1. `chore(license): add LICENSE (AGPLv3) and license fields to all package.json`
2. `feat(legal): add TRADEMARK.md, SECURITY.md, CODE_OF_CONDUCT.md`
3. `feat(env): add lib/env.ts with strict legal config (Zod validation)`
4. `feat(legal): rewrite privacy + terms pages, add legal-notice + cookies pages`
5. `feat(footer): expose 4 legal links, GitHub icon, AGPLv3 badge`
6. `chore(deploy): require GIGAPDF_VPS_HOST and DEPLOY_HOST env vars`
7. `docs(deploy): replace hardcoded IPs with placeholders`
8. `feat(branding): add branding/ folder with logo assets`
9. `ci(dco): add DCO check workflow (tim-actions/dco SHA-pinned)`
10. `chore(github): add issue and PR templates`
11. `docs(contributing): update repo URL, add DCO sign-off section`
12. `docs(readme): rewrite for AGPLv3, trademark, cloud-vs-selfhosted`
13. `docs(changelog): add v1.0.0-oss release notes`

**Tous les commits** signés DCO (`git commit -s`) — auto-application des règles dès la branche.

**Avant merge** :
- Tests CI verts
- Lint clean
- DCO action verte sur tous les commits
- Self-review markdown rendering sur GitHub
- Vérification LICENSE détecté par GitHub (badge "AGPL-3.0-or-later" sur la page repo)

## 10. Risques & mitigations

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Antériorité INPI sur "GigaPDF" | Faible | Élevé (270€ + nom à changer) | Recherche data.inpi.fr avant dépôt |
| Fork qui garde le nom malgré TRADEMARK.md | Moyenne | Moyen | Action légale possible après enregistrement INPI (4-6 mois) |
| Brute-force SSH sur VPS (IP déjà publique) | Élevée | Moyen | fail2ban + port SSH non standard + PasswordAuth=no |
| AGPLv3 fait fuir des contributeurs corporate | Moyenne | Moyen | Acceptable vu objectif communauté self-hosting |
| Mention CGU activables (Stripe/Google) jugée trompeuse | Faible | Faible | Reformulation "ces sous-traitants seront utilisés dès activation des fonctionnalités correspondantes" |
| Self-hoster oublie env vars légales et expose pages vides | Moyenne | Faible | Crash production explicite + doc README claire |

## 11. Critères de succès

Le chantier est terminé quand :

- [ ] PR mergé sur `main` (CI verte, DCO verte)
- [ ] GitHub repo affiche badge "AGPL-3.0-or-later" en sidebar
- [ ] `LICENSE`, `TRADEMARK.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` présents
- [ ] 4 pages légales accessibles depuis le footer
- [ ] `lib/env.ts` validé : prod sans config crash, dev sans config warning
- [ ] Aucune référence à `51.159.105.179` ni `rony@ronylicha.net` dans `git grep` (hors `.git/config` local)
- [ ] DCO bot bloque les PR sans `Signed-off-by:`
- [ ] N° de dépôt INPI obtenu et inscrit dans TRADEMARK.md
- [ ] Annonce publique GitHub Release publiée
- [ ] (Suivi 7j) Reddit + HN + LinkedIn publiés selon la séquence

## 12. Hors scope (à traiter ultérieurement)

- Migration vers `apps/web/src/lib/env.ts` pour TOUTES les env vars (pas seulement légales) — cohérence env vars complète
- EUIPO (marque européenne)
- Traduction des pages légales en anglais (pour la version EN du site)
- GitHub Sponsors / OpenCollective (`.github/FUNDING.yml`) — refusé à ce stade
- Publication des packages individuels sur npm sous le nom @qrcommunication/* — différer
- CLA upgrade si besoin de relicenciement futur — DCO suffit aujourd'hui

---

## Annexe A — Références externes

- AGPLv3 texte officiel : https://www.gnu.org/licenses/agpl-3.0.txt
- AGPLv3 SPDX identifier : `AGPL-3.0-or-later`
- CC-BY-ND 4.0 : https://creativecommons.org/licenses/by-nd/4.0/legalcode
- Contributor Covenant 2.1 : https://www.contributor-covenant.org/version/2/1/code_of_conduct/
- Developer Certificate of Origin v1.1 : https://developercertificate.org
- INPI dépôt en ligne : https://procedures.inpi.fr
- INPI recherche antériorité : https://data.inpi.fr/recherche_avancee/marques
- LCEN article 6 (mentions légales) : https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000801164
- CNIL guide cookies : https://www.cnil.fr/fr/cookies-et-autres-traceurs
- Modèle Mozilla Trademark Policy : https://www.mozilla.org/en-US/foundation/trademarks/policy/
- Modèle Kubernetes Trademark : https://github.com/cncf/foundation/blob/main/trademark-usage.md
