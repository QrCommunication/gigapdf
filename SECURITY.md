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
