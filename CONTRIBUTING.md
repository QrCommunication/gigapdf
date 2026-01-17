# Contributing to GigaPDF

Thank you for your interest in contributing to GigaPDF! This guide will help you get started.

---

## Quick Start

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/gigapdf.git
cd gigapdf

# Add upstream
git remote add upstream https://github.com/ronylicha/gigapdf.git

# Install dependencies
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pnpm install

# Setup environment
cp .env.example .env

# Run migrations
alembic upgrade head
pnpm --filter web prisma db pull && pnpm --filter web prisma generate

# Build packages and start
pnpm build:packages
pnpm dev:all
```

---

## Ways to Contribute

| Type | Description |
|------|-------------|
| **Bug Reports** | [Open an issue](https://github.com/ronylicha/gigapdf/issues/new) |
| **Feature Requests** | Start a [discussion](https://github.com/ronylicha/gigapdf/discussions) |
| **Code** | Submit a pull request |
| **Documentation** | Improve docs or translations |
| **Testing** | Write or improve tests |

Look for issues labeled `good first issue` or `help wanted` to get started.

---

## Development Workflow

### 1. Create a Branch

```bash
# Sync with upstream
git fetch upstream
git checkout main
git merge upstream/main

# Create feature branch
git checkout -b feature/my-feature
```

**Branch naming:**

| Type | Pattern |
|------|---------|
| Feature | `feature/add-ocr-support` |
| Bug fix | `fix/upload-timeout` |
| Docs | `docs/api-reference` |
| Refactor | `refactor/auth-flow` |

### 2. Make Changes

Edit files, then run checks:

```bash
# Backend
black app tests        # Format
ruff check app tests   # Lint
pytest                 # Test

# Frontend
pnpm lint              # Lint
pnpm test              # Test
pnpm type-check        # Types
```

### 3. Commit

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat(api): add OCR endpoint"
git commit -m "fix(editor): resolve canvas rendering on Safari"
git commit -m "docs(readme): update installation instructions"
```

**Commit types:**

| Type | Use for |
|------|---------|
| `feat` | New features |
| `fix` | Bug fixes |
| `docs` | Documentation |
| `refactor` | Code restructuring |
| `test` | Adding tests |
| `chore` | Maintenance |

### 4. Submit PR

```bash
git push origin feature/my-feature
```

Then [create a pull request](https://github.com/ronylicha/gigapdf/compare) with:

- Clear description of changes
- Link to related issues
- Screenshots for UI changes

---

## Code Style

### Python

```python
from typing import Optional
from fastapi import APIRouter

router = APIRouter()

async def get_document(document_id: str) -> Optional[Document]:
    """Retrieve a document by ID."""
    return await repository.get_by_id(document_id)
```

**Tools:** Black (formatting), Ruff (linting), MyPy (types)

### TypeScript

```typescript
interface DocumentCardProps {
  document: Document;
  onDelete: (id: string) => void;
}

export function DocumentCard({ document, onDelete }: DocumentCardProps) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-semibold">{document.name}</h3>
    </div>
  );
}
```

**Tools:** ESLint, Prettier, TypeScript strict mode

---

## Testing

### Backend

```bash
pytest                           # All tests
pytest --cov=app                 # With coverage
pytest tests/unit/test_docs.py   # Specific file
```

### Frontend

```bash
pnpm test              # Run tests
pnpm test -- --watch   # Watch mode
pnpm test -- --coverage
```

---

## Project Structure

```
gigapdf/
├── app/                    # FastAPI backend
│   ├── api/v1/             # REST endpoints
│   ├── models/             # SQLAlchemy models
│   └── services/           # Business logic
├── apps/
│   ├── web/                # Next.js frontend
│   └── admin/              # Admin dashboard
└── packages/               # Shared packages
    ├── ui/                 # UI components
    └── editor/             # PDF editor core
```

---

## Getting Help

- **Questions:** [GitHub Discussions](https://github.com/ronylicha/gigapdf/discussions)
- **Bugs:** [GitHub Issues](https://github.com/ronylicha/gigapdf/issues)
- **Security:** Email security@giga-pdf.com

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

<p align="center">
  Thank you for helping make GigaPDF better!
</p>
