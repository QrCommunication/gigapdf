# Secrets Management

## Vue d'ensemble

Ce document décrit la stratégie de gestion des secrets (credentials, API keys, tokens) dans GigaPDF.

**PRINCIPE FONDAMENTAL** : Aucun secret ne doit être committé dans le repository. Les secrets doivent être :
- Stockés dans des variables d'environnement
- Rotés régulièrement (tous les 90 jours minimum)
- Audités automatiquement via CI/CD
- Protégés en transit (HTTPS/TLS 1.3 uniquement)

---

## Types de Secrets à Gérer

| Type | Exemple | Durée de Vie | Stockage | Rotation |
|------|---------|-------------|----------|----------|
| **PostgreSQL** | `gigapdf_prod_2026` | Permanent | `.env` (prod) | 90 jours |
| **Redis** | Auth token Redis | Permanent | `.env` (prod) | 90 jours |
| **JWT Secret** | Clé de signature JWT | Permanent* | `.env` (prod) | 180 jours (impact sessions) |
| **Stripe Secret** | `sk_live_...` | Permanent | Stripe console | On-demand |
| **API Keys tierces** | S3, SendGrid, etc. | Permanent | `.env` (prod) | 180 jours |
| **Access Tokens** | Auth0, OAuth | Ephémère | Token store | Auto via refresh token |
| **Session Tokens** | Cookie de session | Session | HttpOnly cookie | Session timeout |

*Rotation JWT : Nécessite rehash de tous les tokens actifs — planifier hors-pic

---

## Règles de Base (NON-NEGOTIABLE)

### 1. JAMAIS Committer de Secrets

```bash
# INCORRECT — ne JAMAIS faire cela
echo "POSTGRES_PASSWORD=gigapdf_prod_2026" >> .env
git add .env && git commit -m "add prod creds"

# CORRECT — ajouter .env à .gitignore
echo ".env" >> .gitignore
echo ".env.*.local" >> .gitignore
echo ".env.prod" >> .gitignore
```

### 2. Vérifier `.gitignore`

```bash
# .gitignore — DOIT contenir
.env
.env.local
.env.*.local
.env.prod
.env.staging
.env.test
*.key
*.pem
secrets/
credentials/
.secrets/
```

### 3. Utiliser `.env.example`

```bash
# .env.example — TEMPLATE SANS VALEURS
POSTGRES_HOST=localhost
POSTGRES_USER=gigapdf
POSTGRES_PASSWORD=<ROTATE_EVERY_90_DAYS>
POSTGRES_DB=gigapdf
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=<ROTATE_EVERY_180_DAYS>
JWT_SECRET=<ROTATE_EVERY_180_DAYS>
```

### 4. Documentation Interne SANS Credentials

Dans `/docs/deployment/` ou les README internes :
- Décrire QUOI faire (créer un user PostgreSQL, générer une API key)
- Décrire OÙ stocker (dans `.env` ou secret manager)
- NE PAS stocker les vraies valeurs

---

## Stratégie de Rotation

### Calendrier de Rotation

| Secret | Intervalle | Responsable | Plateforme |
|--------|-----------|-------------|-----------|
| PostgreSQL | 90 jours | DevOps | Production VPS |
| Redis | 90 jours | DevOps | Production VPS |
| JWT Secret | 180 jours | Backend | Planifier hors-pic |
| Stripe Secret | 180 jours | CTO | Stripe console |
| S3/AWS Keys | 90 jours | DevOps | AWS IAM |
| SendGrid API | 180 jours | Backend | SendGrid console |
| Auth0 Secrets | 180 jours | CTO | Auth0 dashboard |

### Processus de Rotation Sécurisé

#### PostgreSQL (Exemple)

**Avant** : Vérifier que la rotation n'impactera pas les connections actives

```bash
#!/bin/bash
# 1. Générer nouveau password
NEW_PASS=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
echo "NEW PASSWORD: $NEW_PASS"

# 2. Mettre à jour PostgreSQL
psql -U postgres -c "ALTER USER gigapdf WITH PASSWORD '$NEW_PASS';"

# 3. Tester la connexion
psql postgresql://gigapdf:$NEW_PASS@localhost:5432/gigapdf -c "SELECT 1;"

# 4. Mettre à jour .env sur la production
ssh ubuntu@production-ip "sed -i \"s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$NEW_PASS|\" /opt/gigapdf/.env"

# 5. Redémarrer les services
ssh ubuntu@production-ip "sudo systemctl restart gigapdf-api gigapdf-celery gigapdf-celery-billing"

# 6. Vérifier que les services sont up
sleep 5
curl -s http://production-ip:8000/health | grep -q "healthy" && echo "✓ API is healthy"

# 7. Documenter dans un endroit sécurisé (1password, Vault, etc.)
# NE PAS laisser en plain text sur la machine locale
```

#### Stripe Secret

1. Aller à Stripe Dashboard → Developers → API Keys
2. Copier la nouvelle clé `sk_live_...`
3. Mettre à jour dans `.env` de production
4. Redéployer
5. Révoquer l'ancienne clé (15 jours après succès)

#### JWT Secret (Impact Maximum)

**ATTENTION** : Les sessions existantes deviendront invalides. À planifier pendant les heures creuses.

1. Générer une nouvelle clé
2. Déployer avec une phase de transition (accepter les 2 clés pendant 24h)
3. Après 24h, utiliser uniquement la nouvelle clé
4. Documenter pour que les clients refresh leurs tokens

---

## Audit Automatisé des Secrets

### Script de Scan (Pre-commit Hook)

```bash
#!/bin/bash
# scripts/audit-secrets.sh

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
PATTERNS=(
  'password\s*[:=]\s*['\''"][^'\''"]{6,}['\''"]'
  'api_key\s*[:=]\s*['\''"][^'\''"]{10,}['\''"]'
  'token\s*[:=]\s*['\''"][^'\''"]{20,}['\''"]'
  'secret\s*[:=]\s*['\''"][^'\''"]{10,}['\''"]'
  'AWS_SECRET_ACCESS_KEY'
  'STRIPE_SECRET'
  'sk_live_'
  'sk_test_'
)

FOUND_SECRETS=0

for pattern in "${PATTERNS[@]}"; do
  if grep -r "$pattern" \
    "$REPO_ROOT" \
    --include="*.py" \
    --include="*.ts" \
    --include="*.tsx" \
    --include="*.js" \
    --include="*.jsx" \
    --include="*.json" \
    --include="*.yml" \
    --include="*.yaml" \
    --include="*.env*" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=dist \
    --exclude-dir=build \
    2>/dev/null | grep -v "example\|template\|placeholder"; then
    echo "❌ FOUND POTENTIAL SECRET PATTERN: $pattern"
    FOUND_SECRETS=1
  fi
done

if [ $FOUND_SECRETS -eq 1 ]; then
  echo ""
  echo "⚠️  SECURITY ALERT: Potential secrets detected in your changes!"
  echo "❌ Commit BLOCKED — Inspect the files above and:"
  echo "   1. Remove the secrets from the repository"
  echo "   2. Add to .gitignore if needed"
  echo "   3. Store in .env or secret manager instead"
  echo "   4. Run 'git update-index --assume-unchanged <file>' if accidentally committed"
  exit 1
fi

echo "✓ No secrets detected"
exit 0
```

### CI/CD Integration (GitHub Actions)

```yaml
# .github/workflows/audit-secrets.yml
name: Secrets Audit

on: [pull_request, push]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: TruffleHog Secrets Scan
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: ${{ github.event.repository.default_branch }}
          head: HEAD

      - name: Check for hardcoded secrets
        run: |
          bash scripts/audit-secrets.sh
```

---

## Gestion par Environnement

### Development

```bash
# .env.local — TEMPLATE
POSTGRES_HOST=localhost
POSTGRES_USER=gigapdf_dev
POSTGRES_PASSWORD=dev_password_change_me
POSTGRES_DB=gigapdf_dev

REDIS_URL=redis://localhost:6379/0

JWT_SECRET=dev_secret_change_me
STRIPE_SECRET_KEY=sk_test_...  # De Stripe Test Mode
```

**Règle** : Utiliser des credentials non-sensibles localement. Les dev passwords n'ont pas besoin d'être "bonnes" — c'est juste du dev.

### Staging

```bash
# `.env.staging` (stocké dans Git secret manager, pas en clair)
POSTGRES_PASSWORD=<GENERATE_NEW>
REDIS_PASSWORD=<GENERATE_NEW>
STRIPE_SECRET_KEY=sk_test_...  # Still test keys
JWT_SECRET=<GENERATE_NEW>
```

**Stockage** : Secret manager (HashiCorp Vault, 1Password, AWS Secrets Manager)

### Production

```bash
# `.env.prod` (JAMAIS dans Git)
POSTGRES_PASSWORD=<ROTATE_90_DAYS>
REDIS_PASSWORD=<ROTATE_90_DAYS>
STRIPE_SECRET_KEY=sk_live_...  # LIVE keys
JWT_SECRET=<ROTATE_180_DAYS>
```

**Stockage** : Secret manager sécurisé (Vault, AWS Secrets Manager, 1Password)

---

## Secret Manager Recommandé

### Pour VPS Scaleway Actuel

**Option 1 : HashiCorp Vault (Self-Hosted)**

```bash
# Installation sur le VPS
docker run -d \
  --name vault \
  -p 8200:8200 \
  -e 'VAULT_DEV_ROOT_TOKEN_ID=root' \
  -e 'VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200' \
  vault:latest

# Utiliser Vault avec les services (via API)
curl -H "X-Vault-Token: root" \
  http://localhost:8200/v1/secret/data/gigapdf/postgres_password
```

**Option 2 : 1Password (SaaS, Recommandé pour Startup)**

```bash
# Installer 1Password CLI
brew install 1password-cli  # ou apt-get pour Linux

# Charger les secrets dans .env
op run --env-file=.env.prod -- ./scripts/deploy.sh
```

**Option 3 : AWS Secrets Manager (Si migration AWS future)**

```bash
# Store secret
aws secretsmanager create-secret \
  --name gigapdf/prod/postgres \
  --secret-string "gigapdf_prod_2026"

# Retrieve in code
import boto3
client = boto3.client('secretsmanager')
secret = client.get_secret_value(SecretId='gigapdf/prod/postgres')
```

---

## État Actuel du Projet (Credentials à Rotationner)

### CRITIQUE : PostgreSQL Credentials

**Endroit où trouvé** :
- Memory file : `/home/rony/.claude/projects/-home-rony-Projets-gigapdf/memory/reference_deployment.md`
- Format : `gigapdf:gigapdf_prod_2026`
- Impact : Production database access

**Actions à Faire** :
1. [ ] Générer nouveau password sécurisé
2. [ ] Mettre à jour PostgreSQL en production
3. [ ] Mettre à jour `.env` sur VPS
4. [ ] Redémarrer les services
5. [ ] Vérifier la connectivity
6. [ ] Documenter dans 1Password/Vault
7. [ ] Nettoyer la memory locale (redact)

### À AUDITER : Autres Credentials

Exécuter le scan automatisé pour trouver :
- [ ] Redis password
- [ ] Stripe secret key
- [ ] JWT secret
- [ ] Auth0 credentials
- [ ] SendGrid API key
- [ ] S3/AWS keys

```bash
# Lancer le scan
bash /home/rony/Projets/gigapdf/scripts/audit-secrets.sh
```

---

## Playbook de Rotation Immédiate

```bash
#!/bin/bash
# Playbook: Rotate PostgreSQL in Production

# 1. Générer credential sécurisé
NEW_PASS=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
echo "Generated password: $NEW_PASS"
echo "⚠️  SAVE THIS IN 1PASSWORD IMMEDIATELY"

# 2. SSH en prod
ssh ubuntu@<your-vps-ip>

# 3. Arrêter les services temporairement
sudo systemctl stop gigapdf-api gigapdf-celery gigapdf-celery-billing

# 4. Updater PostgreSQL
sudo -u postgres psql -c "ALTER USER gigapdf WITH PASSWORD 'NEW_PASS';"

# 5. Updater .env
sudo nano /opt/gigapdf/.env  # Éditer POSTGRES_PASSWORD

# 6. Redémarrer
sudo systemctl start gigapdf-api gigapdf-celery gigapdf-celery-billing

# 7. Vérifier
curl http://localhost:8000/health

# 8. Documenter
echo "Rotated at $(date)" >> /var/log/gigapdf/secrets-rotation.log
```

---

## Checklist de Conformité

- [ ] `.gitignore` contient `.env*`
- [ ] `.env.example` existe SANS credentials
- [ ] Aucun secret dans le code source (tests audit)
- [ ] Production: secrets stockés dans secret manager
- [ ] Staging: secrets dans secret manager ou variables CI
- [ ] Calendrier de rotation défini et automatisé
- [ ] Pre-commit hook configuré pour bloquer les secrets
- [ ] CI/CD scanne pour les secrets (TruffleHog)
- [ ] Tous les services utilisent variables d'env
- [ ] Audit log tenu de toutes les rotations
- [ ] Équipe formée à la sécurité des secrets

---

## Ressources

- [OWASP: Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [NIST: Secret Management](https://csrc.nist.gov/pubs/detail/800-57/part-3/final)
- [HashiCorp Vault](https://www.vaultproject.io/)
- [1Password for Teams](https://1password.com/business/)
- [TruffleHog: Secrets Detection](https://github.com/trufflesecurity/trufflehog)

