# Semantic Search — Server Provisioning & Runbook (#85)

OCR text is searched semantically (meaning, not just keywords) via vector
similarity. This document records the **server-side prerequisites**, what was
installed on production, how to reproduce it, and the known caveats.

## Architecture (where each piece runs)

```
OCR (TS / gigapdf-lib WASM, doc.ocr)         ── produces {page, bbox, text} blocks
        │  POST /api/v1/storage/documents/{id}/ocr-blocks   (owner-only)
        ▼
Python backend (FastAPI / Celery, user `gigapdf`)
   app/services/embeddings.py  ── fastembed → 384-d vector (offline, ONNX)
        │  store_ocr_blocks(): replace-then-embed (idempotent re-index)
        ▼
PostgreSQL 17 + pgvector       ── ocr_blocks.embedding vector(384), HNSW cosine
        ▲
        │  POST /api/v1/search/semantic  ── embed(query) → `<=>` cosine, ownership JOIN
```

- **The lib (gigapdf-lib, WASM) stays pure** (OCR / render / convert). Embeddings
  are an **app** concern: ONNX Runtime is a native lib linked into our own Python
  worker — **not** a third-party CLI we shell out to (unlike the tesseract/poppler
  binaries removed in #61), and **not** a separate daemon (unlike Meilisearch).
- Model: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` — 384-d,
  multilingual (FR+EN). Chosen because fastembed ships no `multilingual-e5-small`
  and this is its only 384-d multilingual model (matches the `vector(384)` schema).

## What is installed on the server

Production VPS `51.159.105.179`, PostgreSQL **17** (cluster `main:5432`, DBs
`gigapdf` + `gigapdf_celery`), services run as user **`gigapdf`**, venv
`/opt/gigapdf/.venv` (Python 3.12).

| Piece | Where | Provisioned by |
|-------|-------|----------------|
| `postgresql-17-pgvector` (0.8.2) | apt | `deploy/setup-server.sh` (idempotent) |
| `CREATE EXTENSION vector` in `gigapdf` | DB | alembic migration `019_add_semantic_search.py` (and setup verified) |
| `fastembed` (0.8.x) + `pgvector` (py) + onnxruntime | `/opt/gigapdf/.venv` | `pip install -r requirements.txt` at deploy |
| Embedding model (~241 MB on disk) | `/var/lib/gigapdf/fastembed-cache` (`gigapdf:gigapdf` 750) | downloaded lazily on first use (or pre-warmed, below) |
| `FASTEMBED_CACHE_DIR=/var/lib/gigapdf/fastembed-cache` | `/opt/gigapdf/.env` (`ubuntu:gigapdf` 640) | `deploy/.env.production.example` / set during provisioning |

## Reproduce on a fresh server (idempotent)

```bash
# 1. pgvector for the running PG major (setup-server.sh does this)
sudo apt-get install -y postgresql-17-pgvector
# 2. extension in the app DB (migration 019 also does this at deploy)
sudo -u postgres psql -p 5432 -d gigapdf -c "CREATE EXTENSION IF NOT EXISTS vector;"
# 3. embedding cache dir (setup-server.sh: mkdir + chown -R gigapdf:gigapdf /var/lib/gigapdf)
sudo install -d -o gigapdf -g gigapdf -m 750 /var/lib/gigapdf/fastembed-cache
# 4. FASTEMBED_CACHE_DIR in /opt/gigapdf/.env (keep ubuntu:gigapdf 640)
grep -q '^FASTEMBED_CACHE_DIR=' /opt/gigapdf/.env || \
  echo 'FASTEMBED_CACHE_DIR=/var/lib/gigapdf/fastembed-cache' | sudo tee -a /opt/gigapdf/.env
# 5. python deps (deploy runs this via requirements.txt)
sudo -u gigapdf /opt/gigapdf/.venv/bin/pip install 'fastembed>=0.8.0,<0.9' 'pgvector>=0.3.0'
# 6. OPTIONAL pre-warm (else the first search downloads ~241 MB, ~a few seconds)
sudo -u gigapdf env FASTEMBED_CACHE_DIR=/var/lib/gigapdf/fastembed-cache \
  HOME=/var/lib/gigapdf/fastembed-cache HF_HOME=/var/lib/gigapdf/fastembed-cache \
  /opt/gigapdf/.venv/bin/python -c \
  "from fastembed import TextEmbedding; \
   list(TextEmbedding('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', \
   cache_dir='/var/lib/gigapdf/fastembed-cache').embed(['warmup']))"
```

## Verify

```bash
# extension present
sudo -u postgres psql -p 5432 -d gigapdf -tAc \
  "SELECT extname||' '||extversion FROM pg_extension WHERE extname='vector';"   # → vector 0.8.2
# python deps + dim
/opt/gigapdf/.venv/bin/python -c "import fastembed,pgvector; print(fastembed.__version__)"
# app still imports after the pip (numpy/onnxruntime upgrades are additive)
/opt/gigapdf/.venv/bin/python -c "import numpy,PIL,fastapi,sqlalchemy,celery,pdfplumber; print('ok')"
# services healthy
for s in gigapdf-api gigapdf-celery gigapdf-celery-billing gigapdf-web gigapdf-admin; do \
  echo "$s: $(systemctl is-active $s)"; done
```

## Caveats (read before trusting search quality)

- **Pooling change.** fastembed **0.8.0** switched this checkpoint to **mean
  pooling** (config-correct) — older releases used CLS. Vectors differ between
  the two, so `requirements.txt` pins `fastembed>=0.8.0,<0.9`. **If you ever bump
  across a pooling change, you must re-embed every `ocr_blocks` row** (the stored
  vectors and the query embeddings must come from the same model+pooling).
- **It is a paraphrase model, not a retrieval model.** On a quick FR probe the
  separation was modest (`query≈relevant` cosine ~0.26 vs `irrelevant` ~0.17):
  the **ranking is correct** but margins are thin. For stronger retrieval,
  A/B a retrieval-tuned multilingual model (e.g. an e5/bge/gte variant) once one
  is available at 384-d in fastembed, or widen the schema to its native dim.
  Validate with **real OCR'd documents** after deploy before relying on it.
- **First-use latency / network.** Without the pre-warm step the model downloads
  from the HuggingFace hub on the first search (~241 MB). The worker needs
  outbound HTTPS at that moment. After caching it is fully offline.
- **Native dep weight.** fastembed pulls ONNX Runtime + numpy. The install is
  additive; confirm the app still imports (above) — a future numpy major could
  need a coordinated bump.

## Related

- `app/services/embeddings.py` — model name, prefix mechanism, lazy singleton.
- `migrations/versions/019_add_semantic_search.py` — extension + `ocr_blocks` + HNSW.
- `app/api/v1/search.py` — `POST /api/v1/search/semantic` (ownership-scoped).
- `deploy/setup-server.sh` — apt pgvector + cache dir provisioning.
