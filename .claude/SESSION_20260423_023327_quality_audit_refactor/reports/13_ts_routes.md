# 13 — TS Routes Architecture Review

## Contexte

21 fichiers `route.ts` analysés dans `apps/web/src/app/api/`.

**Découverte critique sur le middleware** : `apps/web/middleware.ts` exclut **explicitement et totalement** toutes les routes `/api/*` de la protection middleware via son matcher :

```typescript
// middleware.ts — matcher
"/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|public).*)"
//                ^^^^^^^
// Toutes les routes /api/ sont EXCLUES du middleware
```

Cela signifie que le middleware ne protège aucune route API. Chaque route doit assurer sa propre authentification — ce que la majorité ne fait pas.

---

## Checklist par route

| Route | Auth | Zod | File size limit | Codes HTTP | Logger structuré | Rate limit | Verdict |
|-------|------|-----|-----------------|------------|-----------------|------------|---------|
| `/api/pdf/annotations` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/apply-elements` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/convert` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (serverLogger ✓) | NON | FAIL |
| `/api/pdf/encrypt` | AUCUNE | NON (validation manuelle) | NON | 400/401/422/500 ✓ | NON (console.error) | NON | FAIL CRITIQUE |
| `/api/pdf/flatten` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/forms` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/image` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/merge` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/metadata` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/open` | AUCUNE | NON (validation manuelle) | NON | 400/401/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/pages` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/parse` | Better-Auth ✓ | ZOD ✓ (jsonBodySchema) | 100 MB ✓ | 400/401/403/404/413/422/500 ✓ | serverLogger ✓ | NON | PASS (sauf rate limit) |
| `/api/pdf/parse-from-s3` | Bearer header ✓ | ZOD ✓ (RequestBodySchema) | N/A (stream) | 400/401/404/422/500/502/504 ✓ | serverLogger ✓ | NON | PASS (sauf rate limit) |
| `/api/pdf/preview` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/save` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/shape` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/split` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/pdf/text` | AUCUNE | NON (validation manuelle) | NON | 400/422/500 ✓ | NON (console.error) | NON | FAIL |
| `/api/v1/embed/validate-key` | AUCUNE | NON | NON | 400/401/500 ✓ | NON | NON | INTENTIONNEL (public by design) |
| `/api/health` | Better-Auth (info-only) | NON | N/A | 401/500 ✓ | NON | NON | ACCEPTABLE (health check) |
| `/api/auth/[...all]` | Better-Auth handler | N/A | N/A | Géré par lib | N/A | N/A | PASS |

**Résumé** : 2 routes sur 19 routes de traitement PDF ont une authentification. 17 routes sont totalement ouvertes.

---

## Divergences identifiées

### 1. Patterns d'auth hétérogènes entre les 2 routes protégées

- `/api/pdf/parse` utilise `auth.api.getSession({ headers: await headers() })` — Better-Auth session cookie
- `/api/pdf/parse-from-s3` utilise `request.headers.get('Authorization')` — Bearer token manuel, sans vérification de signature JWT côté Next.js (la vérification est déléguée au Python backend)

Ces deux approches ne sont pas substituables. Un client qui fonctionne avec l'une échoue avec l'autre.

### 2. Logger hétérogène : `console.error` vs `serverLogger`

- 16 routes sur 18 utilisent `console.error` directement en production
- 2 routes (`/parse`, `/parse-from-s3`, `/convert`) utilisent `serverLogger` (JSON structuré, stderr en prod)
- `serverLogger` est disponible dans `@/lib/server-logger` et importé correctement dans 3 routes

`console.error` en production produit du texte non-structuré sur stdout/stderr, incompatible avec un agrégateur de logs (Loki, CloudWatch, Datadog).

### 3. Validation sans Zod dans 16 routes sur 18

Les routes non-protégées font de la validation manuelle : `formData.get('field') !== null`, `Number.isInteger()`, `JSON.parse()`. Ces validations sont correctes sur les champs qu'elles couvrent, mais :
- Aucune validation du type MIME du fichier PDF uploadé (sauf `/api/pdf/open` et `/api/pdf/parse`)
- Aucune limite de taille de fichier (sauf `/api/pdf/parse` qui cap à 100 MB)
- Aucune validation Zod donc pas de messages d'erreur standardisés avec `fieldErrors`

### 4. Format de réponse JSON incohérent entre `/api/health` et le reste

- Toutes les routes PDF : `{ success: boolean, error?: string, data?: unknown }`
- `/api/health` : `{ authenticated: boolean, user?: {...} }` — pas de champ `success`
- `/api/v1/embed/validate-key` : `{ valid: boolean }` — pas de champ `success`

Trois formats distincts pour les routes JSON. Pas de type `APIResponse<T>` standardisé.

### 5. `Content-Disposition` avec `file.name` non-sanitizé

Dans toutes les routes qui retournent un PDF binaire :
```typescript
'Content-Disposition': `attachment; filename="${file.name}"`,
```
`file.name` est la valeur fournie par le client, non-sanitizée. Un nom de fichier contenant `"` ou des caractères de contrôle peut corrompre l'en-tête HTTP ou provoquer des comportements inattendus chez certains clients.

### 6. Aucun rate limiting à aucun niveau

Aucune des 18 routes de traitement PDF n'implémente de rate limiting. Il n'y a pas de middleware de rate limiting dans l'app Next.js. La protection existante est uniquement au niveau nginx (si configurée pour `/api/*`).

---

## Top 10 fix cards

### P0-001 — 16 routes PDF sans auth : exposition DDoS/abus
**Problème** : `/api/pdf/convert`, `/api/pdf/encrypt`, `/api/pdf/merge`, et 13 autres routes acceptent des PDF de n'importe qui sans authentification. `/api/pdf/convert` lance Playwright (processus Chrome headless), `/api/pdf/encrypt` effectue des opérations cryptographiques. Ces deux routes en particulier sont exploitables pour du DDoS par épuisement de ressources CPU/mémoire.

**Fix** : Ajouter `withAuth` à toutes les routes concernées. Le pattern de `/api/pdf/parse` est la référence à reproduire :
```typescript
// apps/web/src/lib/api/with-auth.ts  (à créer)
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { session: null, response: NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    )};
  }
  return { session, response: null };
}
```

Utilisation dans chaque route :
```typescript
export async function POST(request: Request): Promise<Response> {
  const { session, response } = await requireSession();
  if (response) return response;
  // ... suite du handler avec session.user.id disponible
}
```

**Priorité** : P0 (security — blocage déploiement)

---

### P0-002 — Middleware exclut toutes les API routes — fausse sécurité
**Problème** : `middleware.ts` contient le matcher `/((?!api|...).*)`  qui exclut explicitement `/api/*`. Le middleware ne protège aucune route API. Cette configuration crée une fausse impression de protection. Un développeur qui ajoute une route sous `/api/` pensera qu'elle est protégée par le middleware — elle ne l'est pas.

**Fix** : Documenter explicitement cette décision dans le middleware avec un commentaire, ET ajouter une validation de session au niveau de chaque route (P0-001). Ne pas modifier le matcher pour inclure `/api/` sans avoir d'abord résolu le pattern d'auth dans chaque route.

```typescript
// middleware.ts
// NOTE ARCHITECTURE : Les routes /api/* sont VOLONTAIREMENT exclues du matcher.
// Chaque route /api/ est responsable de sa propre authentification via requireSession().
// Ne pas ajouter /api/* ici sans avoir vérifié que la route appelle requireSession().
```

**Priorité** : P0 (documentation critique — prévient les régressions futures)

---

### P0-003 — `/api/pdf/encrypt` sans auth : service de chiffrement gratuit
**Problème** : La route `POST /api/pdf/encrypt` accepte n'importe quel PDF, chiffre ou déchiffre avec AES-256, et retourne le résultat sans aucune vérification d'identité. Un attaquant peut l'utiliser comme proxy de chiffrement illimité ou tenter des attaques par force brute de mots de passe via l'action `decrypt`.

**Fix** : Ajouter `requireSession()` au début du handler (fix P0-001), puis ajouter un rate limiting spécifique (max 10 opérations/minute/utilisateur) pour les actions `decrypt` et `encrypt`.

**Priorité** : P0 (security)

---

### P0-004 — `/api/pdf/convert` sans auth : SSRF + DDoS via Playwright
**Problème** : La route lance un processus Chrome headless (Playwright) pour convertir des URLs en PDF. Bien que la validation SSRF soit présente (`validateUrlForPdfConversion` et `shouldBlockPlaywrightRequest`), l'absence d'auth permet à n'importe qui de déclencher des conversions consommant ~200-500 MB de RAM et 15 secondes CPU par requête. Une dizaine de requêtes simultanées peut saturer le serveur.

**Fix** : Ajouter `requireSession()` + rate limiting agressif (max 2 conversions/minute/utilisateur). La validation SSRF existante est correcte et doit être conservée.

**Priorité** : P0 (resource exhaustion)

---

### P1-005 — `console.error` en production dans 16 routes
**Problème** : Les routes utilisent `console.error('[api/pdf/annotations]', error)`. En production, cela produit du texte non-structuré mêlant des stack traces potentiellement sensibles avec les logs d'application normaux. `serverLogger` est déjà disponible dans le projet.

**Fix** : Remplacer `console.error` par `serverLogger.error` dans les 16 routes concernées. Ajouter un champ `error: error instanceof Error ? error.message : String(error)` dans le contexte pour que les stack traces ne soient jamais leakées dans la réponse client.

```typescript
// Avant
console.error('[api/pdf/annotations]', error);

// Après
serverLogger.error('[api/pdf/annotations] Unhandled error', {
  error: error instanceof Error ? error.message : String(error),
});
```

**Priorité** : P1 (observabilité + security)

---

### P1-006 — Aucune limite de taille de fichier sur 17 routes
**Problème** : Seule `/api/pdf/parse` limite la taille à 100 MB. Les 17 autres routes acceptent des fichiers PDF de taille arbitraire. Un PDF de 10 GB peut saturer la RAM du processus Node.js avant même d'atteindre la validation métier.

**Fix** : Ajouter une vérification de taille commune dans le `requireSession()` wrapper ou dans un helper `validatePdfFile()` :

```typescript
// apps/web/src/lib/api/validate-pdf.ts
const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

export function validatePdfFile(file: FormDataEntryValue | null): 
  { file: File } | { error: Response } {
  if (!file || !(file instanceof File)) {
    return { error: NextResponse.json(
      { success: false, error: 'Missing required field: file' },
      { status: 400 }
    )};
  }
  if (file.size > MAX_PDF_SIZE) {
    return { error: NextResponse.json(
      { success: false, error: 'File exceeds the 100 MB size limit.' },
      { status: 413 }
    )};
  }
  return { file };
}
```

**Priorité** : P1 (resource protection)

---

### P1-007 — `Content-Disposition` avec `file.name` non-sanitizé
**Problème** : Dans toutes les routes retournant un PDF binaire, `file.name` (valeur client) est interpolé directement dans l'en-tête HTTP `Content-Disposition`. Un nom de fichier contenant des guillemets ou des caractères CRLF peut corrompre les en-têtes.

**Fix** : Sanitizer le nom de fichier avant utilisation dans l'en-tête :
```typescript
// Remplacer
'Content-Disposition': `attachment; filename="${file.name}"`,

// Par
const safeName = file.name.replace(/[^\w.\-]/g, '_').slice(0, 255);
'Content-Disposition': `attachment; filename="${safeName}"`,
```

**Priorité** : P1 (header injection)

---

### P2-008 — Pas de type `APIResponse<T>` — format JSON incohérent
**Problème** : Trois formats de réponse JSON coexistent : `{ success, error, data }`, `{ authenticated, user }`, `{ valid }`. L'absence d'un type générique standardisé rend la consommation de l'API depuis le frontend fragile.

**Fix** : Créer un type et un helper de réponse centralisés :

```typescript
// apps/web/src/lib/api/response.ts
export interface APIResponse<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
  details?: Record<string, string[]>;
}

export function apiSuccess<T>(data: T, status = 200): Response {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(error: string, status: number, details?: Record<string, string[]>): Response {
  return NextResponse.json({ success: false, error, ...(details && { details }) }, { status });
}
```

**Priorité** : P2 (homogénéité)

---

### P2-009 — Validation sans Zod dans 16 routes
**Problème** : La validation manuelle actuelle (`Number.isInteger`, `JSON.parse`, etc.) est fonctionnelle mais non-standardisée. L'ajout de nouveaux champs nécessite d'écrire chaque fois le même pattern de vérification. Les messages d'erreur varient subtilement entre routes (`'Missing required field: file'` vs `'Missing required field: element (JSON ...)'`).

**Fix** : Migrer vers des schémas Zod pour les paramètres non-binaires. Les `file` champs binaires restent validés manuellement car Zod ne gère pas les `File` FormData nativement. Exemple pour `annotations` :

```typescript
const AnnotationsBodySchema = z.object({
  pageNumber: z.coerce.number().int().min(1, 'pageNumber must be a positive integer'),
  element: z.string().transform((s, ctx) => {
    try { return JSON.parse(s) as AnnotationElement; }
    catch { ctx.addIssue({ code: 'custom', message: 'element must be valid JSON' }); return z.NEVER; }
  }),
});
```

**Priorité** : P2 (maintenabilité)

---

### P2-010 — Aucun rate limiting applicatif sur les routes PDF
**Problème** : Aucune route n'implémente de rate limiting. La protection nginx (`limit_req`) n'est pas confirmée pour les routes `/api/pdf/*`. Sans rate limiting, un utilisateur authentifié peut déclencher des centaines d'opérations PDF en parallèle.

**Fix** : Intégrer `@upstash/ratelimit` ou une solution Redis-based dans le wrapper `requireSession()`. Priorité sur les routes compute-lourdes : `/convert` (Playwright), `/encrypt`, `/merge`, `/split`.

```typescript
// Dans requireSession() ou dans un withRateLimit() wrapper
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '1 m'), // 20 req/min par user
});

const { success } = await ratelimit.limit(session.user.id);
if (!success) {
  return NextResponse.json(
    { success: false, error: 'Rate limit exceeded. Try again later.' },
    { status: 429 }
  );
}
```

**Priorité** : P2 (après P0-001 — inutile sans auth)

---

## Architecture unifiée proposée

### Pattern actuel — problèmes structurels

```
POST /api/pdf/xxx
  ↓ (pas d'auth)
  ↓ Validation manuelle ad-hoc
  ↓ Traitement PDF
  ↓ console.error sur erreur
  ↓ Réponse sans wrapper standardisé
```

### Architecture cible — wrapper de route

Créer trois primitives dans `apps/web/src/lib/api/` :

```
apps/web/src/lib/api/
├── require-session.ts    — auth check, retourne { session } ou { response: 401 }
├── validate-pdf.ts       — file size check, MIME check, retourne { file } ou { response: 400/413 }
└── response.ts           — apiSuccess<T>(), apiError(), APIResponse<T> type
```

**Template de route sécurisé** :

```typescript
import { requireSession } from '@/lib/api/require-session';
import { validatePdfFile } from '@/lib/api/validate-pdf';
import { apiError } from '@/lib/api/response';
import { serverLogger } from '@/lib/server-logger';

export async function POST(request: Request): Promise<Response> {
  // 1. Auth
  const { session, response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    const formData = await request.formData();

    // 2. File validation (taille, présence)
    const { file, error: fileError } = validatePdfFile(formData.get('file'));
    if (fileError) return fileError;

    // 3. Paramètres spécifiques à la route (Zod ou manuel)
    // ...

    // 4. Traitement PDF
    // ...

    // 5. Réponse
    return new Response(...);

  } catch (error: unknown) {
    // 6. Error handling typé
    if (error instanceof PDFCorruptedError) {
      return apiError('PDF file is corrupted.', 422);
    }
    serverLogger.error('[api/pdf/xxx] Unhandled error', {
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError('Failed to process PDF.', 500);
  }
}
```

### Stratégie de refactor — approche progressive recommandée

**Big bang rejeté** : Modifier 16 routes simultanément crée une PR impossible à reviewer et risque de régressions.

**Approche progressive en 3 étapes** :

1. **Sprint 1 — Créer les primitives** (P0, 1 jour)
   - Créer `require-session.ts`, `validate-pdf.ts`, `response.ts`
   - Aucune modification de route existante
   - Ajouter tests unitaires des primitives

2. **Sprint 2 — Sécuriser les routes critiques** (P0, 2 jours)
   - Appliquer `requireSession()` + `validatePdfFile()` aux 4 routes les plus dangereuses : `/convert`, `/encrypt`, `/merge`, `/split`
   - Migrer vers `serverLogger` ces 4 routes
   - PR ciblée, review rapide

3. **Sprint 3 — Homogénéiser les 12 routes restantes** (P1/P2, 3 jours)
   - Appliquer le pattern complet aux 12 routes restantes
   - Migrer vers Zod là où pertinent
   - Ajouter `Content-Disposition` sanitization
   - Une PR par groupe de 3-4 routes

### Règle architecturale à documenter dans CLAUDE.md local

```
RÈGLE : Toute nouvelle route sous apps/web/src/app/api/pdf/ DOIT :
1. Appeler requireSession() en première ligne (sauf routes publiques documentées)
2. Appeler validatePdfFile() pour les routes acceptant un fichier PDF
3. Utiliser serverLogger.error() (jamais console.error/log)
4. Retourner { success: boolean, data?: T, error?: string } pour les réponses JSON
5. Logger userId dans chaque serverLogger.info/warn/error call
```
