# 14 — Config Safety Audit

## Top 10 config risks

---

### P0-001 — images.remotePatterns hostname="**" (SSRF)
**Fichier** : `apps/web/next.config.ts` ligne 101  
**Problème** : Le wildcard `hostname: "**"` autorise Next.js Image Optimization à proxifier des requêtes vers n'importe quelle URL HTTPS. Un attaquant peut cibler `/_next/image?url=https://169.254.169.254/...` (AWS IMDS), des services internes VPS, ou exfiltrer des données via timing side-channel.  
**Fix** : Whitelist explicite — uniquement les domaines réels utilisés :
```typescript
remotePatterns: [
  { protocol: "https", hostname: "cdn.giga-pdf.com" },
  { protocol: "https", hostname: "lh3.googleusercontent.com" }, // Google OAuth avatars
  { protocol: "https", hostname: "avatars.githubusercontent.com" }, // GitHub OAuth avatars
],
```

---

### P0-002 — MAX_UPLOAD_SIZE_MB incohérent : 100MB (Python) vs 500MB (.env.example) vs 500MB (nginx)
**Fichiers** : `app/config.py` ligne 83 · `deploy/.env.production.example` ligne 54 · `deploy/nginx.conf` lignes 87, 228  
**Problème** : La config Python (`max_upload_size_mb: int = 100`) protège contre les PDF-bomb avec une note explicite ("Hard cap lowered to 100 MB"). Mais le `.env.production.example` déploie `MAX_UPLOAD_SIZE_MB=500` — soit 5× plus élevé — et nginx accepte `client_max_body_size 500M`. Si le `.env` de prod suit l'exemple, la limite Python est ignorée et des fichiers 500MB atteignent uvicorn, contournant la mitigation PDF-bomb.  
**Fix** : Aligner les trois à 100MB. Commenter dans `.env.production.example` :
```
MAX_UPLOAD_SIZE_MB=100   # Hard cap — voir app/config.py (PDF-bomb mitigation)
# client_max_body_size nginx doit matcher : 110m (marge nginx → uvicorn)
```

---

### P1-001 — TLSv1.2 autorisé : devrait être TLSv1.3 uniquement
**Fichier** : `deploy/nginx.conf` lignes 59, 206  
**Problème** : `ssl_protocols TLSv1.2 TLSv1.3;` — TLSv1.2 expose à BEAST, LUCKY13, downgrade attacks. Le VPS Scaleway est un serveur moderne (x86_64 récent) qui peut imposer TLSv1.3 seul. TLSv1.2 est conservé par compatibilité avec des clients qui n'en ont pas besoin pour ce type de SaaS PDF.  
**Fix** :
```nginx
ssl_protocols TLSv1.3;
# TLSv1.2 supprimé — tous les navigateurs modernes (2020+) supportent TLSv1.3
```
Si des intégrations tierces requièrent TLSv1.2, les lister explicitement et documenter.

---

### P1-002 — HSTS sans `includeSubDomains` et sans `preload` (incohérence nginx/Next.js)
**Fichier** : `deploy/nginx.conf` lignes 64, 211  
**Problème** : Nginx délivre `Strict-Transport-Security "max-age=63072000"` (2 ans). Next.js ajoute `max-age=31536000; includeSubDomains` (1 an) — deux headers HSTS contradictoires, durées différentes, nginx sans `includeSubDomains`. En pratique, nginx écrase ou concatène selon le chemin de réponse. Sans `preload`, le domaine n'est pas dans la HSTS preload list des navigateurs (premier accès HTTP possible).  
**Fix nginx** :
```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```
Puis supprimer le header HSTS du `next.config.ts` pour éviter la duplication (nginx est autoritaire).

---

### P1-003 — X-XSS-Protection "1; mode=block" déprécié et dangereux
**Fichier** : `deploy/nginx.conf` lignes 69, 216  
**Problème** : Ce header est obsolète depuis 2019. Sur IE/Edge legacy il peut créer des vecteurs XSS en exposant le DOM filtré. OWASP recommande `0` ou suppression. Déjà signalé dans le rapport 02_security.md — toujours présent.  
**Fix** :
```nginx
add_header X-XSS-Protection "0" always;
# ou supprimer la ligne — le CSP de Next.js couvre la protection XSS
```

---

### P1-004 — X-Frame-Options "SAMEORIGIN" sur l'API : devrait être "DENY"
**Fichier** : `deploy/nginx.conf` ligne 67 (bloc `api.giga-pdf.com`)  
**Problème** : L'API REST (`api.giga-pdf.com`) n'a aucune raison d'être embeddée dans un iframe, même du même domaine. `SAMEORIGIN` autorise l'API à être chargée dans un iframe de `giga-pdf.com`, ouvrant la porte à des attaques clickjacking ciblées sur les endpoints sensibles (upload, export).  
**Fix** :
```nginx
add_header X-Frame-Options "DENY" always;
```

---

### P1-005 — MemoryLimit absent sur tous les services systemd
**Fichiers** : `deploy/systemd/gigapdf-api.service` · `gigapdf-celery.service` · `gigapdf-celery-billing.service` · `gigapdf-web.service` · `gigapdf-admin.service`  
**Problème** : Aucun service ne définit `MemoryMax` ou `MemoryHigh`. Sur un VPS 32GB partagé, un job Celery traitant un PDF-bomb (5000 pages) peut consommer plusieurs GB et OOM-killer tout le VPS. Uvicorn avec 4 workers sans limite peut épuiser la RAM sous charge PDF lourde.  
**Fix** (exemple adapté à la RAM disponible) :
```ini
[Service]
MemoryHigh=4G          # Soft limit — systemd ralentit les allocations
MemoryMax=6G           # Hard limit — OOM-kill le worker, pas le VPS
MemorySwapMax=0        # Désactiver le swap pour ce service (latence prévisible)
```
À calibrer selon les métriques réelles : `gigapdf-api` → 2G max, `gigapdf-celery` → 6G max (OCR intensive).

---

### P1-006 — Restart=always sans StartLimitIntervalSec/StartLimitBurst (restart loop infini)
**Fichiers** : Tous les services systemd  
**Problème** : `Restart=always` sans `StartLimitIntervalSec`/`StartLimitBurst` signifie que si un service crashe immédiatement au démarrage (DB inaccessible, config corrompue, port occupé), systemd le relance indéfiniment — créant un busy-loop CPU qui impacte la stabilité du VPS et masque l'erreur réelle.  
**Fix** :
```ini
[Service]
Restart=on-failure       # Plus précis que "always" — pas de restart sur stop manuel
RestartSec=10
StartLimitIntervalSec=300   # Fenêtre de 5 minutes
StartLimitBurst=5            # Max 5 restarts avant abandon (systemd passe en failed)

[Unit]
OnFailure=notify-failure@%n.service  # Optionnel — alerter si abandon
```

---

### P2-001 — gigapdf-web.service et gigapdf-admin.service sans ProtectSystem/ProtectHome
**Fichiers** : `deploy/systemd/gigapdf-web.service` · `deploy/systemd/gigapdf-admin.service`  
**Problème** : Les services Python (`gigapdf-api`, `gigapdf-celery`) ont `ProtectSystem=strict`, `ProtectHome=true`, et `ReadWritePaths=` explicites. Les deux services Next.js n'ont que `NoNewPrivileges=true` et `PrivateTmp=true` — pas de confinement du filesystem. Si un Server Component Next.js est compromis, il peut lire `/opt/gigapdf/.env` (clés Stripe, S3, DB).  
**Fix** :
```ini
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/gigapdf/apps/web /var/log/gigapdf /tmp
PrivateDevices=true
```

---

### P2-002 — Pas de logrotate — logs en append illimité vers /var/log/gigapdf/
**Fichiers** : Tous les services systemd (`StandardOutput=append:/var/log/gigapdf/*.log`)  
**Problème** : Tous les services écrivent en mode `append` direct sans rotation configurée. Aucun fichier logrotate n'est visible dans `deploy/`. Sur un VPS avec stockage limité, les logs API (chaque upload, chaque job Celery) peuvent remplir `/var/log` en quelques semaines et provoquer une indisponibilité complète (uvicorn ne peut plus logger → comportement indéfini).  
**Fix** : Créer `deploy/logrotate/gigapdf` :
```
/var/log/gigapdf/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        systemctl kill --kill-who=main --signal=USR1 gigapdf-api.service || true
    endscript
}
```
Alternativement : migrer les services vers `StandardOutput=journal` et utiliser `journald` avec `SystemMaxUse=2G` dans `/etc/systemd/journald.conf`.

---

## Observations complémentaires

### Positif — ce qui est bien fait
- **User=gigapdf / Group=gigapdf** : tous les services tournent en non-root. Correct.
- **NoNewPrivileges=true + PrivateTmp=true** : présents sur tous les services.
- **APP_DEBUG=false** en production : la config Python a `app_debug: bool = False` comme défaut, et le `.env.production.example` confirme `APP_DEBUG=false`.
- **Fail2ban configuré** : SSH (bantime 24h, maxretry 3), nginx rate-limit et auth — bonne couche de défense réseau.
- **Rate limiting nginx** : `30r/s` global API, `5r/s` upload — dimensionnement raisonnable.
- **proxy_read_timeout 300s** pour l'API : cohérent avec `JOB_TIMEOUT_SECONDS=3600` (jobs longs délégués à Celery, pas en synchrone).
- **WebSocket timeout 86400** : correctement étendu pour les connexions longues Socket.IO.
- **server_tokens** : non configuré (`server_tokens off;` absent) — nginx révèle sa version par défaut. Ajouter dans le bloc `http {}` global.
- **middleware.ts** (non `proxy.ts`) : le projet est sur Next.js 15 ou inférieur selon les fichiers présents — la nomenclature `proxy.ts` est Next.js 16. Pas un risque de sécurité mais à noter pour la migration.

### Cohérence upload size (résumé)
| Couche | Valeur actuelle | Valeur recommandée |
|--------|----------------|-------------------|
| nginx `client_max_body_size` | 500M | 110M (marge +10% sur Python) |
| Python `max_upload_size_mb` | 100MB (code) / 500MB (env example) | 100MB partout |
| Celery `job_timeout_seconds` | 3600s | OK |

### Sentry DSN
- Le champ `sentry_dsn` est vide par défaut et feature-toggled — comportement sécurisé (désactivé si non configuré).
- `sentry_environment` défaut `"production"` — risque de taguer des erreurs dev/staging avec l'environnement prod si le DSN est copié sans changer l'env. Recommander `default=""` (forcer la config explicite).

### embed_jwt_secret
- `embed_jwt_secret` avec `default=""` en production est documenté comme "insecure fallback used". Le code devrait lever une `ValueError` au démarrage si `app_env == "production"` et `embed_jwt_secret == ""`. Actuellement, un oubli de configuration silencieux est possible.

