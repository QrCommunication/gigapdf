# Audit des licences - GigaPDF

**Session:** MIGRATION_PDFLIB_20260312
**Date:** 2026-03-12
**Scope:** Toutes les dependances directes Python + Node.js
**Objectif:** Compatibilite avec un usage SaaS commercial

---

## RESUME EXECUTIF

| Categorie | Nombre |
|-----------|--------|
| **BLOCK (incompatible SaaS)** | **1** |
| **WARNING (a evaluer)** | **1** |
| **OK (compatible)** | **103** |
| **Total dependances auditees** | **105** |

---

## 1. DEPENDANCES BLOCK (a supprimer obligatoirement)

### PyMuPDF (aka `fitz`)

| Champ | Valeur |
|-------|--------|
| Package | `PyMuPDF>=1.23.0` |
| Licence | **GNU AGPL-3.0** (ou licence commerciale Artifex) |
| Fichier | `requirements.txt` ligne 9 |
| Risque | **CRITIQUE** - L'AGPL-3.0 impose la publication du code source de toute application qui utilise la bibliotheque, y compris via un acces reseau (SaaS). Incompatible avec un produit SaaS commercial a code ferme. |
| Option commerciale | Artifex propose une licence commerciale payante (contact: sales@artifex.com). Le cout est significatif et negocie au cas par cas. |

**Recommandations de remplacement (par ordre de preference) :**

| Alternative | Licence | Fonctionnalites | Effort migration |
|-------------|---------|------------------|-----------------|
| **pypdf** (deja present) | BSD-3-Clause | Lecture/ecriture/merge/split PDF, extraction texte. Pas de rendu image. | Faible - deja dans requirements.txt |
| **pdfplumber** | MIT | Extraction texte/tableaux, base sur pdfminer.six (MIT) | Moyen |
| **pikepdf** | MPL-2.0 | Manipulation PDF bas-niveau, base sur QPDF (Apache-2.0) | Moyen |
| **borb** | AGPL-3.0 / commercial | Attention: meme probleme AGPL. Version commerciale disponible. | N/A |
| **pdfjs-dist** (cote Node) | Apache-2.0 | Rendu PDF, deja utilise dans @giga-pdf/canvas | Nul (deja present) |

**Action recommandee :** Combiner `pypdf` (manipulation) + `pdfjs-dist` (rendu) + `pdf2image`/`Pillow` (conversion image via Poppler, licence GPL mais outil externe en CLI = pas de linking). Supprimer PyMuPDF immediatement.

---

## 2. DEPENDANCES WARNING (a evaluer)

### psycopg2-binary

| Champ | Valeur |
|-------|--------|
| Package | `psycopg2-binary>=2.9.9` |
| Licence | **LGPL-3.0 with exceptions** |
| Fichier | `requirements.txt` ligne 26 |
| Risque | **FAIBLE** - La LGPL autorise l'utilisation dans un logiciel proprietaire tant que la bibliotheque est utilisee dynamiquement (linking dynamique, ce qui est le cas en Python via import). La "LGPL with exceptions" de psycopg2 est encore plus permissive. |
| Verdict | **Compatible SaaS** - Aucune action requise. L'exception de licence de psycopg2 autorise explicitement l'utilisation dans des logiciels proprietaires. |

**Alternative si souhaite (par prudence extreme) :**

| Alternative | Licence | Notes |
|-------------|---------|-------|
| **psycopg[binary]** (psycopg3) | LGPL-3.0 | Meme licence, mais version plus moderne |
| **asyncpg** (deja present) | Apache-2.0 | Uniquement async, deja dans requirements.txt |

---

## 3. DEPENDANCES OK (compatibles SaaS commercial)

### 3.1 Python (requirements.txt) - 27 packages

| Package | Licence | Statut |
|---------|---------|--------|
| fastapi | MIT | OK |
| uvicorn | BSD-3-Clause | OK |
| python-multipart | Apache-2.0 | OK |
| pydantic | MIT | OK |
| pydantic-settings | MIT | OK |
| pypdf | BSD-3-Clause | OK |
| reportlab | BSD | OK |
| pdf2image | MIT | OK |
| Pillow | MIT-CMU (HPND) | OK |
| pytesseract | Apache-2.0 | OK |
| python-socketio | MIT | OK |
| celery | BSD-3-Clause | OK |
| redis | MIT | OK |
| asyncpg | Apache-2.0 | OK |
| SQLAlchemy | MIT | OK |
| alembic | MIT | OK |
| python-jose | MIT | OK |
| httpx | BSD-3-Clause | OK |
| cryptography | Apache-2.0 OR BSD-3-Clause | OK |
| python-docx | MIT | OK |
| openpyxl | MIT | OK |
| python-dateutil | Apache-2.0 OR BSD | OK |
| aiofiles | Apache-2.0 | OK |
| psutil | BSD-3-Clause | OK |
| boto3 | Apache-2.0 | OK |
| stripe | MIT | OK |

### 3.2 Node.js - Racine (package.json) - 1 package

| Package | Licence | Source |
|---------|---------|--------|
| @better-auth/expo | MIT | package.json (root) |

### 3.3 Node.js - apps/web (package.json) - 14 packages

| Package | Licence | Statut |
|---------|---------|--------|
| @better-auth/expo | MIT | OK |
| @prisma/adapter-pg | Apache-2.0 | OK |
| @prisma/client | Apache-2.0 | OK |
| better-auth | MIT | OK |
| clsx | MIT | OK |
| fabric | MIT | OK |
| jose | MIT | OK |
| lucide-react | ISC | OK |
| next | MIT | OK |
| next-intl | MIT | OK |
| next-themes | MIT | OK |
| nodemailer | MIT-0 | OK |
| pg | MIT | OK |
| react / react-dom | MIT | OK |
| tailwind-merge | MIT | OK |
| zod | MIT | OK |

### 3.4 Node.js - apps/admin (package.json) - 12 packages

| Package | Licence | Statut |
|---------|---------|--------|
| @prisma/client | Apache-2.0 | OK |
| @tanstack/react-table | MIT | OK |
| bcryptjs | BSD-3-Clause | OK |
| better-auth | MIT | OK |
| date-fns | MIT | OK |
| jose | MIT | OK |
| lucide-react | ISC | OK |
| next | MIT | OK |
| next-intl | MIT | OK |
| next-themes | MIT | OK |
| react / react-dom | MIT | OK |
| recharts | MIT | OK |
| zod | MIT | OK |

### 3.5 Node.js - apps/mobile (package.json) - 33 packages

| Package | Licence | Statut |
|---------|---------|--------|
| @better-auth/expo | MIT | OK |
| @expo/vector-icons | MIT | OK |
| @react-native-async-storage/async-storage | MIT | OK |
| @react-navigation/native | MIT | OK |
| @tanstack/react-query | MIT | OK |
| axios | MIT | OK |
| better-auth | MIT | OK |
| expo | MIT | OK |
| expo-auth-session | MIT | OK |
| expo-blur | MIT | OK |
| expo-constants | MIT | OK |
| expo-crypto | MIT | OK |
| expo-document-picker | MIT | OK |
| expo-file-system | MIT | OK |
| expo-font | MIT | OK |
| expo-image-picker | MIT | OK |
| expo-linking | MIT | OK |
| expo-localization | MIT | OK |
| expo-network | MIT | OK |
| expo-router | MIT | OK |
| expo-secure-store | MIT | OK |
| expo-sharing | MIT | OK |
| expo-status-bar | MIT | OK |
| expo-web-browser | MIT | OK |
| i18next | MIT | OK |
| react | MIT | OK |
| react-i18next | MIT | OK |
| react-native | MIT | OK |
| react-native-gesture-handler | MIT | OK |
| react-native-pdf | MIT | OK |
| react-native-reanimated | MIT | OK |
| react-native-safe-area-context | MIT | OK |
| react-native-screens | MIT | OK |
| react-native-svg | MIT | OK |
| react-native-toast-message | MIT | OK |
| zustand | MIT | OK |

### 3.6 Node.js - packages/ui (package.json) - 16 packages

| Package | Licence | Statut |
|---------|---------|--------|
| @radix-ui/react-dialog | MIT | OK |
| @radix-ui/react-dropdown-menu | MIT | OK |
| @radix-ui/react-label | MIT | OK |
| @radix-ui/react-popover | MIT | OK |
| @radix-ui/react-progress | MIT | OK |
| @radix-ui/react-scroll-area | MIT | OK |
| @radix-ui/react-select | MIT | OK |
| @radix-ui/react-separator | MIT | OK |
| @radix-ui/react-slider | MIT | OK |
| @radix-ui/react-slot | MIT | OK |
| @radix-ui/react-switch | MIT | OK |
| @radix-ui/react-tabs | MIT | OK |
| @radix-ui/react-toast | MIT | OK |
| @radix-ui/react-toggle-group | MIT | OK |
| @radix-ui/react-tooltip | MIT | OK |
| class-variance-authority | Apache-2.0 | OK |
| clsx | MIT | OK |
| cmdk | MIT | OK |
| lucide-react | ISC | OK |
| tailwind-merge | MIT | OK |

### 3.7 Node.js - packages/editor (package.json) - 2 packages

| Package | Licence | Statut |
|---------|---------|--------|
| immer | MIT | OK |
| zustand | MIT | OK |

### 3.8 Node.js - packages/canvas (package.json) - 2 packages

| Package | Licence | Statut |
|---------|---------|--------|
| fabric | MIT | OK |
| pdfjs-dist | Apache-2.0 | OK |

### 3.9 Node.js - packages/api (package.json) - 3 packages

| Package | Licence | Statut |
|---------|---------|--------|
| @tanstack/react-query | MIT | OK |
| axios | MIT | OK |
| socket.io-client | MIT | OK |

### 3.10 Node.js - packages/billing (package.json) - 3 packages

| Package | Licence | Statut |
|---------|---------|--------|
| @stripe/react-stripe-js | MIT | OK |
| @stripe/stripe-js | MIT | OK |
| lucide-react | ISC | OK |

### 3.11 Node.js - packages/s3 (package.json) - 2 packages

| Package | Licence | Statut |
|---------|---------|--------|
| @aws-sdk/client-s3 | Apache-2.0 | OK |
| @aws-sdk/s3-request-presigner | Apache-2.0 | OK |

---

## 4. CLASSIFICATION DES LICENCES

### Licences presentes dans le projet

| Licence | Nombre | Compatibilite SaaS |
|---------|--------|---------------------|
| MIT | 74 | OK |
| Apache-2.0 | 14 | OK |
| BSD-3-Clause | 7 | OK |
| ISC | 3 | OK |
| MIT-0 | 1 | OK |
| MIT-CMU (HPND) | 1 | OK |
| Apache-2.0 OR BSD-3-Clause | 1 | OK |
| Apache-2.0 OR BSD | 1 | OK |
| BSD | 1 | OK |
| LGPL-3.0 (with exceptions) | 1 | WARNING |
| **AGPL-3.0** | **1** | **BLOCK** |

---

## 5. PLAN D'ACTION

### Immediat (P0 - avant mise en production)

1. **Supprimer PyMuPDF** de `requirements.txt`
2. **Migrer le code** qui utilise `fitz` (PyMuPDF) vers :
   - `pypdf` pour la manipulation PDF (merge, split, extraction texte)
   - `reportlab` pour la generation PDF
   - `pdf2image` + `Pillow` pour la conversion PDF vers images (utilise Poppler en CLI)
   - `pdfjs-dist` (cote frontend, deja present) pour le rendu PDF

### Optionnel (amelioration)

3. **psycopg2-binary** : Aucune action necessaire. La licence LGPL avec exceptions est compatible. Si migration souhaitee, passer a `psycopg[binary]` (psycopg 3) qui est plus performant.

### Maintenance continue

4. Integrer `pip-licenses` et `license-checker` (npm) dans la CI/CD pour detecter automatiquement les nouvelles dependances a licence problematique.
5. Bloquer les licences AGPL/GPL/SSPL via une regle CI.

---

## 6. NOTES METHODOLOGIQUES

- Les licences Python ont ete verifiees via PyPI API (champs `license`, `license_expression`, `classifiers`).
- Les licences Node.js ont ete verifiees via les fichiers `package.json` dans `node_modules`.
- Les packages workspace (`@giga-pdf/*`) ont ete exclus car ce sont des packages internes.
- Les `devDependencies` n'ont pas ete auditees car elles ne sont pas distribuees avec le produit final (outils de build, lint, types, etc.).
- La licence `MIT-0` (nodemailer) est une variante MIT sans clause d'attribution, encore plus permissive que MIT.
- La licence `ISC` (lucide-react) est fonctionnellement equivalente a MIT.
- La licence `HPND` / `MIT-CMU` (Pillow) est une licence permissive historique, compatible commercial.
