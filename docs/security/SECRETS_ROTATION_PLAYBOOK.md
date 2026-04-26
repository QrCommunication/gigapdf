# Secrets Rotation Playbook

**Status**: ⚠️ IMMEDIATE ACTION REQUIRED
**Priority**: CRITICAL  
**Timeline**: Complete within 24 hours

---

## Quick Start: PostgreSQL Password Rotation

### Prerequisites

- SSH access to production (`<your-vps-ip>`)
- 1Password or password manager access
- 5-10 minutes downtime tolerance (services restart)

### Step-by-Step Execution

#### 1. Prepare (2 min)

```bash
# From your local machine
cd /home/rony/Projets/gigapdf

# Make script executable
chmod +x scripts/rotate-postgres-password.sh

# Verify SSH connectivity
ssh -T ubuntu@<your-vps-ip> "echo '✓ SSH OK'"
```

#### 2. Execute Rotation (3 min)

```bash
# Run rotation script
./scripts/rotate-postgres-password.sh --host <your-vps-ip> --user ubuntu

# Script will:
# 1. Generate new secure password
# 2. Ask for confirmation
# 3. Connect to production
# 4. Update PostgreSQL user
# 5. Backup .env
# 6. Update .env with new password
# 7. Restart services
# 8. Verify health

# OUTPUT: New password displayed
# ⚠️  SAVE THIS PASSWORD IMMEDIATELY TO 1PASSWORD/VAULT
```

#### 3. Verify Success (2 min)

```bash
# The script performs health checks automatically
# But manually verify:

ssh ubuntu@<your-vps-ip>

# Check services running
systemctl status gigapdf-api gigapdf-celery gigapdf-celery-billing

# Test API connectivity
curl -s http://localhost:8000/health | jq .

# Check database connectivity
sudo -u postgres psql -c "SELECT 1;"
```

#### 4. Document (1 min)

```bash
# Save new password to 1Password
# Entry: GigaPDF PostgreSQL Production
# Fields:
#   - Username: gigapdf
#   - Password: [NEW_PASSWORD]
#   - Host: <your-vps-ip>
#   - Database: gigapdf
#   - Rotation Date: [Today]
#   - Next Rotation: [+90 days]

# Document in team calendar
# "PostgreSQL rotation completed — next due: [date+90]"
```

#### 5. Cleanup (1 min)

```bash
# Clear shell history (contains temp password)
history -c && exit

# On production server
history -c && logout
```

---

## Rollback Procedure (If Issues)

The script includes automatic rollback. If something goes wrong:

```bash
# The script will:
# 1. Detect health check failure
# 2. Restore backup .env
# 3. Restart services with old password
# 4. Exit with error

# If you need manual rollback:
ssh ubuntu@<your-vps-ip>

# Restore backup
sudo cp /opt/gigapdf/.env.backup /opt/gigapdf/.env

# Restart services
sudo systemctl restart gigapdf-api gigapdf-celery gigapdf-celery-billing

# Verify
curl -s http://localhost:8000/health
```

---

## Common Issues & Solutions

### Issue: SSH connection failed

```bash
# Check SSH key
ssh-keyscan -H <your-vps-ip> >> ~/.ssh/known_hosts

# Try again
./scripts/rotate-postgres-password.sh
```

### Issue: PostgreSQL password update failed

```bash
# Manual fix:
ssh ubuntu@<your-vps-ip>
sudo -u postgres psql -c "ALTER USER gigapdf WITH PASSWORD 'new_password';"
```

### Issue: Services won't start after rotation

```bash
# Check logs
sudo tail -100f /var/log/gigapdf/*.log

# Verify password in .env
sudo grep POSTGRES_PASSWORD /opt/gigapdf/.env

# Manual restart
sudo systemctl restart gigapdf-api
```

### Issue: Health check timeout

```bash
# Wait a bit longer
sleep 10
curl -s http://localhost:8000/health

# Check service logs
sudo journalctl -u gigapdf-api -n 50
```

---

## Rotation Schedule (90-Day Cycle)

### Calendar Template

| Date | Credential | Status |
|------|-----------|--------|
| 2026-04-21 | PostgreSQL | ✓ **ROTATE NOW** |
| 2026-07-20 | PostgreSQL | [ ] Due next |
| 2026-10-19 | PostgreSQL | [ ] Due |
| 2027-01-17 | PostgreSQL | [ ] Due |

### Set Calendar Reminders

- **Email reminder**: 7 days before rotation
- **Slack notification**: 3 days before rotation
- **Team stand-up**: Day-of rotation discussion

---

## Other Credentials to Rotate

Once PostgreSQL is done, audit and rotate the others:

### Redis Password (90 days)

```bash
# Check current password
ssh ubuntu@<your-vps-ip>
grep REDIS_PASSWORD /opt/gigapdf/.env

# Rotation:
# 1. Update Redis config
# 2. Update all clients (.env)
# 3. Restart services
# Timeline: Similar to PostgreSQL
```

### JWT Secret (180 days)

⚠️ **HIGH IMPACT** — Invalidates all active sessions

```bash
# Plan rotation for off-peak hours (e.g., 2 AM UTC)
# 1. Generate new JWT_SECRET
# 2. Deploy with transition phase (accept both keys for 24h)
# 3. Notify users of potential re-login
# Timeline: 180 days
```

### Stripe Secret Key (180 days)

```bash
# 1. Go to Stripe Dashboard
# 2. Developers → API Keys
# 3. Copy new sk_live_...
# 4. Update STRIPE_SECRET_KEY in .env
# 5. Redeploy
# 6. Revoke old key (15 days later)
# Timeline: 180 days
```

### AWS/S3 Keys (90 days)

```bash
# 1. AWS Console → IAM → Users → [User]
# 2. Create new access key
# 3. Update AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# 4. Redeploy
# 5. Deactivate old key (15 days later)
# Timeline: 90 days
```

---

## Master Rotation Calendar (2026)

```
April 21, 2026 — PostgreSQL ✓ DONE
July 20, 2026 — PostgreSQL, Redis
October 19, 2026 — PostgreSQL, AWS Keys
December 19, 2026 — JWT Secret (HIGH IMPACT)
January 17, 2027 — PostgreSQL
April 17, 2027 — PostgreSQL, Redis, Stripe
```

---

## Automation (Future)

Once comfortable with manual rotation, automate:

### GitHub Actions: Monthly Reminder

```yaml
# .github/workflows/secrets-rotation-reminder.yml
name: Secrets Rotation Reminder

on:
  schedule:
    # Remind 7 days before rotation dates
    - cron: '0 9 13,14,20,21 * *'

jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - name: Create issue for rotation
        run: |
          # Create GitHub issue for rotation team
          gh issue create \
            --title "Secrets rotation due" \
            --body "Check playbook: docs/security/SECRETS_ROTATION_PLAYBOOK.md"
```

### Vault: Automatic Rotation

```bash
# If using HashiCorp Vault:
vault write -f auth/approle/role/gigapdf-rotation/secret-id
vault read -f auth/approle/role/gigapdf-rotation/secret-id
```

---

## Team Communication Template

### Pre-Rotation (3 days before)

**Slack/Email**:
```
🔑 Upcoming: PostgreSQL Password Rotation
Date: [Date] at [Time] UTC
Duration: ~15 minutes (minimal disruption)
Impact: Transparent to users
Action: None required from your end
Questions? See: docs/security/SECRETS_ROTATION_PLAYBOOK.md
```

### Post-Rotation (Day of)

**Slack/Email**:
```
✓ PostgreSQL password successfully rotated
Time taken: 12 minutes
Status: All services healthy
Next rotation: [+90 days]
```

---

## Audit Trail

Keep a log of all rotations:

```bash
# On production server
cat /var/log/gigapdf/secrets-rotation.log

# Example entry:
# [2026-04-21 15:30:45] PostgreSQL password rotation completed successfully
# [2026-04-21 15:31:12] Services verified healthy
# [2026-04-21 15:32:00] Password stored in 1Password
```

---

## After Rotation Checklist

- [ ] New password saved to 1Password/Vault
- [ ] Calendar updated with next rotation date (+90 days)
- [ ] Team notified of completion
- [ ] Audit log updated
- [ ] No errors in service logs
- [ ] Health check passed
- [ ] SSH history cleared
- [ ] Documentation updated

---

**Last Updated**: April 21, 2026  
**Rotation Due**: April 21, 2026 (IMMEDIATE)  
**Next Rotation**: July 20, 2026

