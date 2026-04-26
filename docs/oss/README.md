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
