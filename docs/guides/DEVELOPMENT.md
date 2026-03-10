# Development Guide / Guide de développement

A comprehensive guide for developing and contributing to GigaPDF.

Un guide complet pour développer et contribuer à GigaPDF.

---

## Table of Contents / Table des matières

1. [Project Structure](#project-structure)
2. [Development Workflow](#development-workflow)
3. [Backend Development](#backend-development)
4. [Frontend Development](#frontend-development)
5. [Package Development](#package-development)
6. [Testing](#testing)
7. [Code Quality](#code-quality)
8. [Git Workflow](#git-workflow)
9. [Debugging](#debugging)

---

## Project Structure

### Overview / Vue d'ensemble

```
gigapdf/
├── app/                          # FastAPI Backend
│   ├── api/
│   │   ├── v1/                   # API v1 endpoints
│   │   │   ├── documents.py      # Document CRUD
│   │   │   ├── pages.py          # Page operations
│   │   │   ├── elements.py       # Element manipulation
│   │   │   ├── storage.py        # File storage
│   │   │   ├── billing.py        # Subscription management
│   │   │   └── ...
│   │   └── websocket.py          # Real-time collaboration
│   ├── core/                     # Core utilities
│   │   ├── security.py           # JWT validation
│   │   └── database.py           # Database connection
│   ├── models/                   # SQLAlchemy models
│   ├── schemas/                  # Pydantic schemas
│   ├── services/                 # Business logic
│   ├── repositories/             # Data access layer
│   ├── tasks/                    # Celery async tasks
│   ├── middleware/               # Request middleware
│   ├── utils/                    # Utility functions
│   ├── config.py                 # Configuration
│   ├── dependencies.py           # FastAPI dependencies
│   └── main.py                   # Application entry point
│
├── apps/
│   ├── web/                      # Next.js Web Application
│   │   ├── src/
│   │   │   ├── app/              # App Router pages
│   │   │   │   ├── (auth)/       # Auth routes (login, register)
│   │   │   │   ├── (dashboard)/  # Protected dashboard
│   │   │   │   ├── editor/       # PDF editor
│   │   │   │   └── api/          # API routes
│   │   │   ├── components/       # React components
│   │   │   ├── lib/              # Utilities
│   │   │   └── hooks/            # Custom hooks
│   │   ├── prisma/               # Database schema
│   │   └── messages/             # i18n translations
│   │
│   └── admin/                    # Admin Dashboard
│       ├── src/
│       │   ├── app/              # Admin pages
│       │   └── components/       # Admin components
│       └── prisma/               # Admin schema
│
├── packages/
│   ├── ui/                       # Shared UI components
│   ├── api/                      # API client
│   ├── types/                    # TypeScript types
│   ├── canvas/                   # PDF canvas renderer
│   ├── editor/                   # WYSIWYG editor
│   ├── billing/                  # Stripe integration
│   ├── s3/                       # S3 storage client
│   ├── logger/                   # Logging utilities
│   ├── eslint-config/            # Shared ESLint config
│   ├── typescript-config/        # Shared TS config
│   └── tailwind-config/          # Shared Tailwind config
│
├── migrations/                   # Alembic migrations
├── tests/                        # Backend tests
│   ├── unit/
│   └── integration/
├── docs/                         # Documentation
├── scripts/                      # Utility scripts
└── deploy/                       # Deployment configs
```

---

## Development Workflow

### Starting Development Servers / Démarrer les serveurs de développement

Open multiple terminals:

```bash
# Terminal 1: Backend API with hot reload
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Web application
pnpm dev:web
# or: pnpm --filter web dev

# Terminal 3: Admin panel
pnpm dev:admin
# or: pnpm --filter admin dev

# Terminal 4: Celery worker (for async tasks)
source venv/bin/activate
celery -A app.tasks.celery_app worker --loglevel=debug

# Terminal 5: Celery beat (for scheduled tasks)
celery -A app.tasks.celery_app beat --loglevel=debug
```

### Development URLs / URLs de développement

| Service | URL |
|---------|-----|
| Backend API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/api/docs |
| ReDoc | http://localhost:8000/api/redoc |
| Web App | http://localhost:3000 |
| Admin Panel | http://localhost:3001 |

### Monorepo Commands / Commandes monorepo

```bash
# Run command in all packages
pnpm dev                          # Start all dev servers
pnpm build                        # Build all packages
pnpm lint                         # Lint all packages
pnpm type-check                   # Type check all packages
pnpm test                         # Run all tests

# Run command in specific app/package
pnpm --filter web dev             # Web app only
pnpm --filter admin build         # Admin build only
pnpm --filter @giga-pdf/ui build  # UI package only

# Clean up
pnpm clean                        # Clean build outputs
pnpm clean:all                    # Clean all node_modules
```

---

## Backend Development

### Creating a New Endpoint / Créer un nouvel endpoint

1. **Create the schema** in `app/schemas/`:

```python
# app/schemas/example.py
from pydantic import BaseModel
from typing import Optional

class ExampleCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ExampleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
```

2. **Create the model** in `app/models/`:

```python
# app/models/example.py
from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base
import uuid

class Example(Base):
    __tablename__ = "examples"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, server_default="now()")
```

3. **Create the service** in `app/services/`:

```python
# app/services/example_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.example import Example
from app.schemas.example import ExampleCreate

class ExampleService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: ExampleCreate) -> Example:
        example = Example(**data.model_dump())
        self.db.add(example)
        await self.db.commit()
        await self.db.refresh(example)
        return example
```

4. **Create the endpoint** in `app/api/v1/`:

```python
# app/api/v1/examples.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.services.example_service import ExampleService
from app.schemas.example import ExampleCreate, ExampleResponse
from app.dependencies import get_current_user

router = APIRouter(prefix="/examples", tags=["Examples"])

@router.post("", response_model=ExampleResponse)
async def create_example(
    data: ExampleCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Create a new example.

    Crée un nouvel exemple.
    """
    service = ExampleService(db)
    return await service.create(data)
```

5. **Register the router** in `app/api/v1/router.py`:

```python
from app.api.v1.examples import router as examples_router

api_router.include_router(examples_router)
```

6. **Create migration**:

```bash
alembic revision --autogenerate -m "add examples table"
alembic upgrade head
```

### Async Database Access / Accès base de données asynchrone

GigaPDF uses SQLAlchemy 2.x async patterns:

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

async def get_by_id(db: AsyncSession, id: str):
    result = await db.execute(
        select(Example).where(Example.id == id)
    )
    return result.scalar_one_or_none()

async def get_all(db: AsyncSession, limit: int = 100):
    result = await db.execute(
        select(Example).limit(limit)
    )
    return result.scalars().all()
```

### Background Tasks / Tâches en arrière-plan

Using Celery for async processing:

```python
# app/tasks/example_tasks.py
from app.tasks.celery_app import celery_app

@celery_app.task(bind=True, max_retries=3)
def process_example(self, example_id: str):
    try:
        # Long-running task
        result = heavy_computation(example_id)
        return result
    except Exception as exc:
        self.retry(exc=exc, countdown=60)
```

Trigger from endpoint:

```python
from app.tasks.example_tasks import process_example

@router.post("/{id}/process")
async def start_processing(id: str):
    task = process_example.delay(id)
    return {"task_id": task.id}
```

---

## Frontend Development

### Adding a New Page / Ajouter une nouvelle page

1. **Create page file** in `apps/web/src/app/`:

```tsx
// apps/web/src/app/(dashboard)/examples/page.tsx
import { ExampleList } from "@/components/examples/example-list";

export default function ExamplesPage() {
  return (
    <div className="container py-6">
      <h1 className="text-2xl font-bold mb-6">Examples</h1>
      <ExampleList />
    </div>
  );
}
```

2. **Create component**:

```tsx
// apps/web/src/components/examples/example-list.tsx
"use client";

import { useExamples } from "@/hooks/use-examples";
import { Card, CardContent } from "@giga-pdf/ui";

export function ExampleList() {
  const { data, isLoading, error } = useExamples();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data?.map((example) => (
        <Card key={example.id}>
          <CardContent>
            <h3>{example.name}</h3>
            <p>{example.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

3. **Create custom hook**:

```tsx
// apps/web/src/hooks/use-examples.ts
import useSWR from "swr";
import { apiClient } from "@/lib/api";

export function useExamples() {
  return useSWR("/api/v1/examples", apiClient.get);
}
```

### Using Shared UI Components / Utiliser les composants UI partagés

Import from `@giga-pdf/ui`:

```tsx
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  Input,
  Label,
} from "@giga-pdf/ui";
```

### Internationalization (i18n) / Internationalisation

1. **Add translations** in `apps/web/messages/`:

```json
// messages/en.json
{
  "examples": {
    "title": "Examples",
    "create": "Create Example",
    "empty": "No examples found"
  }
}

// messages/fr.json
{
  "examples": {
    "title": "Exemples",
    "create": "Créer un exemple",
    "empty": "Aucun exemple trouvé"
  }
}
```

2. **Use in components**:

```tsx
import { useTranslations } from "next-intl";

export function ExampleList() {
  const t = useTranslations("examples");

  return (
    <div>
      <h1>{t("title")}</h1>
      <Button>{t("create")}</Button>
    </div>
  );
}
```

---

## Package Development

### Modifying Shared Packages / Modifier les packages partagés

After modifying a package, rebuild it:

```bash
# Rebuild specific package
pnpm --filter @giga-pdf/ui build

# Rebuild all packages
pnpm build:packages
```

### Adding a New UI Component / Ajouter un nouveau composant UI

1. **Create component** in `packages/ui/src/components/`:

```tsx
// packages/ui/src/components/badge.tsx
import * as React from "react";
import { cn } from "../lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "warning" | "error";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        {
          "bg-primary text-primary-foreground": variant === "default",
          "bg-green-500 text-white": variant === "success",
          "bg-yellow-500 text-white": variant === "warning",
          "bg-red-500 text-white": variant === "error",
        },
        className
      )}
      {...props}
    />
  );
}
```

2. **Export from index**:

```tsx
// packages/ui/src/index.tsx
export { Badge } from "./components/badge";
```

3. **Rebuild package**:

```bash
pnpm --filter @giga-pdf/ui build
```

---

## Testing

### Backend Tests / Tests backend

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/unit/test_documents.py

# Run specific test
pytest tests/unit/test_documents.py::test_create_document

# Run with verbose output
pytest -v

# Run only marked tests
pytest -m "slow"
```

#### Writing Tests / Écrire des tests

```python
# tests/unit/test_example_service.py
import pytest
from unittest.mock import AsyncMock
from app.services.example_service import ExampleService
from app.schemas.example import ExampleCreate

@pytest.fixture
def mock_db():
    return AsyncMock()

@pytest.fixture
def service(mock_db):
    return ExampleService(mock_db)

class TestExampleService:
    async def test_create_example(self, service, mock_db):
        data = ExampleCreate(name="Test", description="Test description")

        result = await service.create(data)

        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()
```

### Frontend Tests / Tests frontend

```bash
# Run all frontend tests
pnpm test

# Run tests for specific app
pnpm --filter web test

# Watch mode
pnpm --filter web test -- --watch
```

---

## Code Quality

### Python Code Quality / Qualité du code Python

```bash
# Format code with Black
black app tests

# Lint with Ruff
ruff check app tests

# Auto-fix linting issues
ruff check app tests --fix

# Type checking with MyPy
mypy app
```

### TypeScript Code Quality / Qualité du code TypeScript

```bash
# Lint all TypeScript
pnpm lint

# Auto-fix linting issues
pnpm lint:fix

# Format with Prettier
pnpm format

# Check formatting
pnpm format:check

# Type check
pnpm type-check
```

### Pre-commit Hooks / Hooks pre-commit

The project uses Husky for pre-commit hooks:

```bash
# Install hooks (automatic with pnpm install)
pnpm prepare
```

On commit, the following runs automatically:
- ESLint for TypeScript files
- Prettier for formatting
- Type checking

---

## Git Workflow

### Branch Naming / Nommage des branches

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/description` | `feature/add-ocr-support` |
| Bug fix | `fix/description` | `fix/upload-timeout` |
| Hotfix | `hotfix/description` | `hotfix/security-patch` |
| Docs | `docs/description` | `docs/api-reference` |

### Commit Messages / Messages de commit

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code refactoring
- `test`: Tests
- `chore`: Maintenance

Examples:
```
feat(api): add OCR endpoint for scanned documents
fix(editor): resolve canvas rendering on Safari
docs(readme): update installation instructions
refactor(billing): simplify subscription logic
```

### Pull Request Process / Processus de pull request

1. Create feature branch from `main`
2. Make changes and commit
3. Push branch and create PR
4. Wait for CI checks to pass
5. Request review
6. Merge after approval

---

## Debugging

### Backend Debugging / Débogage backend

#### VS Code Configuration

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "FastAPI Debug",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": ["app.main:app", "--reload", "--port", "8000"],
      "jinja": true,
      "justMyCode": false
    }
  ]
}
```

#### Logging

```python
import logging

logger = logging.getLogger(__name__)

logger.debug("Debug message")
logger.info("Info message")
logger.warning("Warning message")
logger.error("Error message")
```

### Frontend Debugging / Débogage frontend

#### React DevTools

Install the React DevTools browser extension for component inspection.

#### Next.js Debug Mode

```bash
# Enable debug mode
NODE_OPTIONS='--inspect' pnpm dev:web
```

Then open `chrome://inspect` in Chrome.

#### API Request Debugging

```tsx
// Temporarily log API responses
const { data, error } = useSWR("/api/v1/documents", async (url) => {
  const response = await apiClient.get(url);
  console.log("API Response:", response);
  return response;
});
```

### Database Debugging / Débogage base de données

```bash
# Connect to database
psql -U gigapdf -d gigapdf

# View tables
\dt

# Describe table
\d documents

# Run query
SELECT * FROM documents LIMIT 5;
```

### Redis Debugging / Débogage Redis

```bash
# Connect to Redis
redis-cli

# List all keys
KEYS *

# Get key value
GET "key_name"

# Monitor real-time commands
MONITOR
```

---

## Next Steps / Prochaines étapes

- **[API Reference](../api/README.md)** - Detailed API documentation
- **[Deployment Guide](DEPLOYMENT.md)** - Production deployment
- **[Architecture Overview](../ARCHITECTURE.md)** - System design
- **[Contributing Guide](../../CONTRIBUTING.md)** - Contribution guidelines
