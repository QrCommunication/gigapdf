# Master Plan — GigaPDF API Publique + SDK Embed

**Session**: API_PUBLIC_20260312
**Date**: 2026-03-12
**Strategie**: Frontend s'adapte au backend | iframe securise | API Keys simples

## Waves

| Wave | Contenu | Statut | Dependances |
|------|---------|--------|-------------|
| -1 | Impact Analysis | DONE | - |
| 1 | DB: table api_keys + migration | DONE | - |
| 2 | Backend: middleware API key + CORS + endpoints CRUD | DONE | Wave 1 |
| 3 | Backend: enrichir OpenAPI | DONE (13/13 agents) | - |
| 4 | Frontend: aligner hooks packages/api | DONE | - |
| 5 | packages/embed: SDK iframe + vanilla + React | DONE | Wave 2 |
| 6 | apps/web: route /embed/[token] + docs publiques | DONE | Wave 5 |
| 7 | Tests | DONE | Waves 1-6 |
| 8 | Regression Guard | DONE (2 CRITICAL fixes applied) | Wave 7 |

## Decisions

- Backend endpoints = source de verite
- Auth externe = API Keys (header X-API-Key, prefix giga_pk_)
- SDK embed = iframe securise avec postMessage
- Auth interne (JWT + Better Auth) inchangee

## Livrables Wave 2

- `app/middleware/api_key_auth.py` — middleware X-API-Key (SHA-256, rate limit, domain check)
- `app/api/v1/api_keys.py` — CRUD (POST/GET/PATCH/DELETE)
- `app/schemas/api_keys.py` — schemas Pydantic
- `app/api/v1/router.py` — include api_keys router
- `app/main.py` — middleware registered

## Livrables Wave 5

- `packages/embed/src/types.ts` — interfaces GigaPdfOptions, events, messages
- `packages/embed/src/index.ts` — classe GigaPdfEditor + GigaPdf.init()
- `packages/embed/src/react.tsx` — composant React avec forwardRef
- `packages/embed/package.json` — exports CJS/ESM + react sub-export
- `packages/embed/tsup.config.ts` — build config
