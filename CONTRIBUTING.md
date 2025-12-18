# Contributing to GigaPDF / Contribuer à GigaPDF

Thank you for your interest in contributing to GigaPDF! This document provides guidelines and instructions for contributing.

Merci de votre intérêt pour contribuer à GigaPDF ! Ce document fournit des directives et des instructions pour contribuer.

---

## Table of Contents / Table des matières

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Making Changes](#making-changes)
5. [Pull Request Process](#pull-request-process)
6. [Coding Standards](#coding-standards)
7. [Testing Guidelines](#testing-guidelines)
8. [Documentation](#documentation)
9. [Community](#community)

---

## Code of Conduct

### Our Pledge / Notre engagement

We are committed to providing a welcoming and inclusive environment for everyone. We expect all contributors to:

- Be respectful and considerate
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

---

## Getting Started

### Types of Contributions / Types de contributions

We welcome several types of contributions:

| Type | Description |
|------|-------------|
| **Bug Reports** | Report issues you've found |
| **Feature Requests** | Suggest new features |
| **Code** | Submit bug fixes or new features |
| **Documentation** | Improve or translate docs |
| **Testing** | Write or improve tests |
| **Design** | UI/UX improvements |

### Finding Issues to Work On / Trouver des issues

1. Check [GitHub Issues](https://github.com/your-org/gigapdf/issues)
2. Look for issues labeled:
   - `good first issue` - Great for newcomers
   - `help wanted` - Community help needed
   - `bug` - Bug fixes
   - `enhancement` - New features

---

## Development Setup

### Prerequisites / Prérequis

- Python 3.12+
- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- pnpm 9+
- Git

### Setup Steps / Étapes de configuration

```bash
# 1. Fork the repository on GitHub

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/gigapdf.git
cd gigapdf

# 3. Add upstream remote
git remote add upstream https://github.com/your-org/gigapdf.git

# 4. Install dependencies
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
pnpm install

# 5. Setup environment
cp .env.example .env
# Edit .env with your local settings

# 6. Setup database
alembic upgrade head
cd apps/web && npx prisma db push && cd ../..

# 7. Build packages
pnpm --filter @giga-pdf/ui build

# 8. Start development servers
# Terminal 1: Backend
uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend
pnpm --filter web dev
```

---

## Making Changes

### Branch Naming / Nommage des branches

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/description` | `feature/add-ocr-support` |
| Bug fix | `fix/description` | `fix/upload-timeout` |
| Hotfix | `hotfix/description` | `hotfix/security-patch` |
| Docs | `docs/description` | `docs/api-reference` |
| Refactor | `refactor/description` | `refactor/auth-flow` |

### Workflow / Flux de travail

```bash
# 1. Sync with upstream
git fetch upstream
git checkout main
git merge upstream/main

# 2. Create feature branch
git checkout -b feature/my-feature

# 3. Make changes
# ... edit files ...

# 4. Run tests
pytest                    # Backend tests
pnpm test                 # Frontend tests
pnpm lint                 # Lint check

# 5. Commit changes
git add .
git commit -m "feat(scope): description"

# 6. Push to your fork
git push origin feature/my-feature

# 7. Create Pull Request on GitHub
```

---

## Pull Request Process

### Before Submitting / Avant de soumettre

- [ ] Code follows project style guidelines
- [ ] All tests pass locally
- [ ] New code has adequate test coverage
- [ ] Documentation is updated if needed
- [ ] Commit messages follow conventions
- [ ] Branch is up-to-date with main

### PR Description Template / Modèle de description PR

```markdown
## Summary
Brief description of changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #123

## Testing Done
Describe testing performed.

## Screenshots (if applicable)
Add screenshots for UI changes.

## Checklist
- [ ] Tests pass
- [ ] Linting passes
- [ ] Documentation updated
```

### Review Process / Processus de revue

1. **Automated checks**: CI runs tests, linting, and type checks
2. **Code review**: A maintainer reviews the changes
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, the PR will be merged
5. **Merge**: Maintainer merges using squash or rebase

---

## Coding Standards

### Python (Backend) / Python (Backend)

#### Style Guide / Guide de style

- Follow [PEP 8](https://pep8.org/)
- Use [Black](https://black.readthedocs.io/) for formatting
- Use [Ruff](https://docs.astral.sh/ruff/) for linting
- Use type hints

```python
# Good example
from typing import Optional
from fastapi import APIRouter, Depends

router = APIRouter()

async def get_document(
    document_id: str,
    user_id: str,
) -> Optional[Document]:
    """
    Retrieve a document by ID.

    Args:
        document_id: The document identifier.
        user_id: The requesting user's ID.

    Returns:
        The document if found, None otherwise.
    """
    return await repository.get_by_id(document_id, user_id)
```

#### Commands / Commandes

```bash
# Format code
black app tests

# Lint code
ruff check app tests

# Fix linting issues
ruff check app tests --fix

# Type check
mypy app
```

### TypeScript (Frontend) / TypeScript (Frontend)

#### Style Guide / Guide de style

- Follow project ESLint configuration
- Use [Prettier](https://prettier.io/) for formatting
- Use TypeScript strict mode
- Prefer functional components with hooks

```typescript
// Good example
import { useState, useCallback } from "react";
import { Button } from "@giga-pdf/ui";

interface DocumentCardProps {
  document: Document;
  onDelete: (id: string) => void;
}

export function DocumentCard({ document, onDelete }: DocumentCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDelete(document.id);
    } finally {
      setIsDeleting(false);
    }
  }, [document.id, onDelete]);

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-semibold">{document.name}</h3>
      <Button
        variant="destructive"
        disabled={isDeleting}
        onClick={handleDelete}
      >
        {isDeleting ? "Deleting..." : "Delete"}
      </Button>
    </div>
  );
}
```

#### Commands / Commandes

```bash
# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Type check
pnpm type-check
```

### Commit Messages / Messages de commit

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

#### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change, no new feature |
| `perf` | Performance improvement |
| `test` | Adding/updating tests |
| `chore` | Maintenance tasks |

#### Examples / Exemples

```bash
# Feature
feat(api): add OCR endpoint for scanned documents

# Bug fix
fix(editor): resolve canvas rendering on Safari

# Documentation
docs(readme): update installation instructions

# Breaking change
feat(auth)!: migrate to RS256 JWT tokens

BREAKING CHANGE: JWT tokens now use RS256 algorithm.
Update AUTH_JWT_ALGORITHM in your environment.
```

---

## Testing Guidelines

### Backend Testing / Tests backend

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific tests
pytest tests/unit/test_documents.py
pytest tests/unit/test_documents.py::test_create_document -v
```

#### Writing Tests / Écrire des tests

```python
import pytest
from unittest.mock import AsyncMock

class TestDocumentService:
    @pytest.fixture
    def mock_repository(self):
        return AsyncMock()

    @pytest.fixture
    def service(self, mock_repository):
        return DocumentService(mock_repository)

    async def test_create_document_success(self, service, mock_repository):
        # Arrange
        mock_repository.create.return_value = Document(id="123", name="Test")

        # Act
        result = await service.create(CreateDocument(name="Test"))

        # Assert
        assert result.id == "123"
        mock_repository.create.assert_called_once()

    async def test_create_document_invalid_name(self, service):
        # Arrange & Act & Assert
        with pytest.raises(ValidationError):
            await service.create(CreateDocument(name=""))
```

### Frontend Testing / Tests frontend

```bash
# Run tests
pnpm test

# Watch mode
pnpm test -- --watch

# Coverage
pnpm test -- --coverage
```

---

## Documentation

### When to Update Docs / Quand mettre à jour la doc

- New features: Add to README and relevant guides
- API changes: Update API reference
- Breaking changes: Note in CHANGELOG
- Bug fixes: Update if behavior changes

### Documentation Style / Style de documentation

- Use clear, concise language
- Include code examples
- Add both English and French translations when possible
- Use tables for structured data
- Include screenshots for UI features

---

## Community

### Getting Help / Obtenir de l'aide

- **GitHub Discussions**: Ask questions, share ideas
- **GitHub Issues**: Report bugs, request features
- **Pull Requests**: Contribute code

### Recognition / Reconnaissance

Contributors are recognized in:
- Release notes
- CONTRIBUTORS.md file
- Project documentation

---

## License / Licence

By contributing, you agree that your contributions will be licensed under the MIT License.

En contribuant, vous acceptez que vos contributions soient sous licence MIT.

---

Thank you for contributing to GigaPDF! / Merci de contribuer à GigaPDF !
