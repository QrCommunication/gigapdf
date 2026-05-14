# 15 — TS/Next.js Deep Security Audit

> Read-only analysis. No source files modified.
> Scope: apps/web/src/, apps/admin/src/, packages/api/src/
> Based on: Phase 1 report (02_security.md) + React editor report (12_react_editor.md) + direct code review

---

## Top 10 findings par CVSS-like scoring

---

### P0-001 — 15 routes /api/pdf/* entierement non protegees (unauthenticated)

**CVSS estime** : 8.6 (High)
**Vector** : AV:N / AC:L / PR:N / UI:N / S:U / C:L / I:L / A:H
**Fichiers** : apps/web/middleware.ts (ligne 67) + toutes les routes apps/web/src/app/api/pdf/

**Constat** : Le middleware Next.js exclut explicitement tous les appels API de son matcher :

```
matcher: [
  "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|public).*)",
]
```

Le pattern exclut /api/pdf/*, /api/v1/* et toutes les routes API. Il n'existe aucun code d'authentification dans les route handlers eux-memes. Les routes suivantes sont accessibles sans token :

- /api/pdf/encrypt - chiffrement/dechiffrement de PDFs arbitraires (service gratuit)
- /api/pdf/convert - conversion URL-to-PDF via Playwright (CPU intensif, 15s/requete)
- /api/pdf/apply-elements - modification de PDFs
- /api/pdf/save, /api/pdf/merge, /api/pdf/split, /api/pdf/flatten, etc.

**Impact** : DDoS applicatif par saturation du pool WASM PDF.js et du processus Playwright. La route /api/pdf/convert avec timeout 15s est particulierement exploitable.

**Fix** : Ajouter la verification de session dans chaque route handler :

```typescript
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  // reste du handler...
}
```

---

### P0-002 — JWT stocke dans sessionStorage (accessible via XSS)

**CVSS estime** : 7.8 (High)
**Vector** : AV:N / AC:L / PR:N / UI:R / S:U / C:H / I:H / A:N
**Fichier** : apps/web/src/lib/api.ts (lignes 17-38)

**Constat** : Le token JWT Better Auth est stocke dans sessionStorage :

```typescript
// api.ts lignes 24-38
export function setAuthToken(token: string | null) {
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);  // Accessible par JS
}
export function getAuthToken(): string | null {
  return sessionStorage.getItem(AUTH_TOKEN_KEY);  // Lisible par XSS
}
```

Ce token est consomme dans 6 fichiers : api.ts, editor-canvas.tsx, use-document.ts,
use-document-save.ts, page.tsx (editeur), dashboard/page.tsx, documents/page.tsx.
sessionStorage est accessible a tout JavaScript s'executant sur la page.
Les regles du projet interdisent explicitement ce pattern.

**Fix** : Supprimer setAuthToken/getAuthToken. Laisser Better Auth gerer l'auth via
ses cookies HttpOnly. Pour les appels API qui requirent le JWT vers Python, utiliser
un proxy Next.js cote serveur qui lit la session Better Auth et ajoute le Bearer
token cote serveur sans l'exposer au client.

---

### P0-003 — Admin panel (apps/admin) : appels API Python sans credentials

**CVSS estime** : 7.5 (High)
**Vector** : AV:N / AC:L / PR:L / UI:N / S:U / C:H / I:H / A:N
**Fichier** : apps/admin/src/lib/api.ts (lignes 275-293)

**Constat** : Le client API du panel admin envoie des requetes vers le Python backend
sans aucune credential :

```typescript
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      // Aucun Authorization header, aucun credentials: 'include'
    },
  });
```

Les routes appelees incluent /api/v1/admin/users, /api/v1/admin/stats/overview,
/api/v1/admin/documents - toutes protegees cote Python par get_current_admin_user.
Sans credentials, ces appels devraient echouer avec 401/403. Si ces appels reussissent
en production, il existe un bypass de l'authentification.

**Fix** :

```typescript
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const session = await authClient.getSession();
  const token = session?.data?.session?.token;
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    credentials: 'include',
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
```

---

### P1-004 — Admin proxy.ts : pas de verification du role admin

**CVSS estime** : 7.2 (High)
**Vector** : AV:N / AC:L / PR:L / UI:N / S:U / C:H / I:H / A:N
**Fichier** : apps/admin/src/proxy.ts (lignes 26-51)

**Constat** : Le middleware admin verifie qu'une session existe mais ne verifie pas
que l'utilisateur a le role admin :

```typescript
const session = await response.json();
if (!session || !session.user) {
  return NextResponse.redirect(new URL("/login", request.url));
}
// Aucune verification session.user.role === 'super_admin'
return NextResponse.next();  // Tout utilisateur avec compte valide entre
```

Tout utilisateur avec un compte valide (meme un compte standard) qui connait l'URL
du panel admin peut acceder a l'interface. La fonction requireSuperAdmin() existe
dans apps/admin/src/lib/auth.ts mais n'est jamais appelee dans le middleware.

**Fix** :

```typescript
const user = session.user;
if (!user || user.role !== 'super_admin') {
  return NextResponse.redirect(new URL("/login?error=forbidden", request.url));
}
return NextResponse.next();
```

---

### P1-005 — Injection dans Content-Disposition via file.name non sanitise

**CVSS estime** : 6.4 (Medium-High)
**Vector** : AV:N / AC:L / PR:N / UI:R / S:C / C:L / I:L / A:N
**Fichiers** : 10 route handlers sous apps/web/src/app/api/pdf/

**Constat** : Tous les handlers PDF retournent le nom de fichier original non sanitise :

```typescript
// Pattern repete dans 10 fichiers (save, encrypt, apply-elements, annotations, etc.)
'Content-Disposition': `attachment; filename="${file.name}"`
```

Un attaquant peut uploader un fichier avec un nom contenant des caracteres de controle
HTTP pour injecter des headers arbitraires (HTTP Header Injection). Vecteur exploitable
pour du cache poisoning ou du XSS selon l'infrastructure de livraison.

**Fix** :

```typescript
function sanitizeFilename(name: string): string {
  return name
    .replace(/["\r\n\0]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .substring(0, 255);
}

// Ou mieux, utiliser la forme RFC 5987 :
`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
```

---

### P1-006 — Email verification desactivee en production (les deux apps)

**CVSS estime** : 6.1 (Medium-High)
**Vector** : AV:N / AC:L / PR:N / UI:N / S:U / C:L / I:L / A:N
**Fichiers** : apps/web/src/lib/auth.ts (ligne 40), apps/admin/src/lib/auth.ts (ligne 34)

**Constat** :

```typescript
// apps/web/src/lib/auth.ts ligne 40
requireEmailVerification: false, // Set to true in production
// apps/admin/src/lib/auth.ts ligne 34
requireEmailVerification: false,
```

Malgre le commentaire, l'email verification est desactivee en production dans les
deux applications. Cela permet la creation de comptes avec des emails fictifs ou
usurpes, et facilite l'enumeration d'emails valides via les codes d'erreur.

**Fix** : Activer immediatement dans les deux configs :

```typescript
requireEmailVerification: true,
```

---

### P1-007 — SSRF via images.remotePatterns wildcard

**CVSS estime** : 5.8 (Medium)
**Vector** : AV:N / AC:H / PR:N / UI:N / S:C / C:H / I:N / A:N
**Fichier** : apps/web/next.config.ts (lignes 98-103)

**Constat** : Configuration Next.js image optimization avec wildcard total :

```typescript
images: {
  remotePatterns: [{ protocol: "https", hostname: "**" }],
}
```

Permet des requetes vers des services internes via /_next/image?url=https://169.254.169.254/...
(metadata AWS/GCP). Le protocol "https" ne filtre pas les IPs internes accessibles via HTTPS.

**Fix** : Whitelist stricte des domaines legitimes :

```typescript
images: {
  remotePatterns: [
    { protocol: "https", hostname: "cdn.giga-pdf.com" },
    { protocol: "https", hostname: "lh3.googleusercontent.com" },
    { protocol: "https", hostname: "avatars.githubusercontent.com" },
  ],
}
```

---

### P2-008 — validate-key : NEXT_PUBLIC_API_URL utilise cote serveur

**CVSS estime** : 4.3 (Medium)
**Vector** : AV:N / AC:L / PR:N / UI:N / S:U / C:L / I:N / A:N
**Fichier** : apps/web/src/app/api/v1/embed/validate-key/route.ts (ligne 3)

**Constat** :

```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
```

Ce route handler s'execute cote serveur (Next.js API route) mais utilise NEXT_PUBLIC_API_URL
- une variable publique exposee dans le bundle client. Les route handlers serveur doivent
utiliser des variables purement serveur. Il faudrait utiliser PYTHON_BACKEND_URL (variable
serveur uniquement, comme dans parse-from-s3/route.ts).

**Fix** :

```typescript
const API_BASE_URL = process.env.PYTHON_BACKEND_URL ?? 'http://127.0.0.1:8000';
```

---

### P2-009 — Zod absent sur 14 des 15 routes /api/pdf/*

**CVSS estime** : 4.0 (Medium)
**Vector** : AV:N / AC:L / PR:N / UI:N / S:U / C:N / I:L / A:L
**Fichiers** : Toutes les routes PDF sauf parse-from-s3 et parse

**Constat** : Seules 2 routes sur 15 utilisent Zod pour valider les inputs.
Les 13 autres utilisent des castings TypeScript directs sans validation :

```typescript
// apply-elements/route.ts ligne 98
operations = JSON.parse(operationsRaw) as ElementOperation[];
// Aucune validation : pageNumber peut etre NaN, negatif ou Infinity
// action peut etre toute string, pas uniquement 'add'|'update'|'delete'
```

**Fix** : Appliquer Zod sur toutes les routes. Exemple pour apply-elements :

```typescript
const ElementOperationSchema = z.object({
  action: z.enum(['add', 'update', 'delete']),
  pageNumber: z.number().int().min(1).max(10000),
  element: z.record(z.unknown()),
  oldBounds: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
});
const OperationsSchema = z.array(ElementOperationSchema).max(1000);
```

---

### P2-010 — Taille des uploads PDF non limitee sur 13 routes

**CVSS estime** : 3.8 (Medium-Low)
**Vector** : AV:N / AC:L / PR:N / UI:N / S:U / C:N / I:N / A:H
**Fichiers** : save, encrypt, apply-elements, annotations, text, shape, image, flatten, merge, split, pages, forms, preview

**Constat** : Seule /api/pdf/parse/route.ts a une limite explicite de 100 MB.
Les 13 autres routes acceptent des fichiers sans limite de taille. Next.js n'impose
pas de limite par defaut sur le formData multipart. Un attaquant peut envoyer des
fichiers de plusieurs centaines de MB pour saturer la memoire Node.js.

**Fix** : Ajouter dans chaque route handler :

```typescript
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

if (file.size > MAX_FILE_SIZE) {
  return NextResponse.json(
    { success: false, error: 'File exceeds the 100 MB size limit.' },
    { status: 413 },
  );
}
```

---

## Positifs confirmes

**SSRF sur URL-to-PDF activement mitigue** : apps/web/src/app/api/pdf/convert/route.ts
implemente une defense en profondeur SSRF exemplaire avec pre-validation DNS (liste exhaustive
des plages IP privees RFC 1918, 169.254.0.0/16, 100.64.0.0/10, IPv6 ULA, NAT64),
blocage des redirects Playwright vers des IPs privees, et timeout strict a 15s.
Le fichier apps/web/src/lib/security/url-validation.ts est un modele de securite.

**Better Auth correctement configure cote serveur** : Configuration RS256 JWT avec
plugin jwt(), sessions avec expiresIn 7 jours, cookie cache 5 minutes. Le plugin
expo() est correctement isole pour le support mobile.

**CSP presente dans next.config.ts** : Headers de securite complets (CSP, HSTS,
X-Frame-Options DENY, Permissions-Policy, Referrer-Policy) avec distinction embed/non-embed.

**Route parse-from-s3 securisee** : Seule route qui combine import server-only +
validation Zod + verification Authorization header + timeout AbortController +
logging structure. Pattern de reference a reproduire sur toutes les routes PDF.

**Secrets non commites** : Aucun secret reel dans le depot. NEXT_PUBLIC_ ne contient
que des URLs non-sensibles et le DSN Sentry (public by design).

**Admin Python backend bien protege** : get_current_admin_user dependency FastAPI
est appliquee a tout le router admin via dependencies=[Depends(get_current_admin_user)]
au niveau du module - protection correcte cote backend.

**Absence de fuite XSS DOM directe** : Aucun usage de dangerouslySetInnerHTML
dans tout le codebase web. Pas de vecteur XSS DOM direct identifie.

---

## Resume des priorites

| ID     | Titre                                        | CVSS  | Effort |
|--------|----------------------------------------------|-------|--------|
| P0-001 | 15 routes /api/pdf/* sans auth               | 8.6   | M      |
| P0-002 | JWT dans sessionStorage                      | 7.8   | M      |
| P0-003 | Admin panel sans credentials API             | 7.5   | S      |
| P1-004 | Admin proxy sans verification role           | 7.2   | T      |
| P1-005 | Content-Disposition injection                | 6.4   | S      |
| P1-006 | Email verification desactivee                | 6.1   | T      |
| P1-007 | SSRF image wildcard                          | 5.8   | T      |
| P2-008 | NEXT_PUBLIC_ cote serveur (validate-key)     | 4.3   | T      |
| P2-009 | Zod absent sur 14 routes PDF                 | 4.0   | M      |
| P2-010 | Taille upload non limitee (13 routes)        | 3.8   | S      |
