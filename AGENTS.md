# AGENTS.md

LDS scripture study tool that returns verbatim quotes from Church-approved sources (no AI summaries). Two independent codebases run together via Docker Compose.

## Repo layout

- `app/` — Next.js 14 web app (TypeScript, App Router). Its own `package.json`.
- `ingest/` — Python 3.11 ingestion pipeline. Its own `requirements.txt`.
- `db/init/01-schema.sql` — Postgres + pgvector schema, mounted into the db container at startup.
- `tasks.md` — task tracker; several "done" items were implemented in git history. Not a spec to re-do.

These are **not** one shared toolchain: run TS/JS commands from `app/`, Python from `ingest/`. There are **no tests** (no jest/vitest/pytest). Verification = `lint`, `typecheck`, and manual docker run.

## Commands

From `app/`:
- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint`
- `npm run typecheck` (tsc --noEmit)

Ingest (from repo root, needs `db` up and `.env`):
- `docker compose run --rm ingest python -m scripts.run_ingest <command>`
- Commands: `download_bible`, `download_conference`, `download_supplementary`, `download_all`, then `scripture`, `conference`, `supplementary`, `all`. Order matters: download first, then ingest.

## Setup / environment

- `.env` is required and gitignored; copy `.env.example`. `DATABASE_URL` uses host `db` (docker network).
- `EMBEDDING_DIMENSIONS` must match your model's output and is **applied at runtime**: schema defaults to `vector(1024)`, but both `app/lib/db.ts:19` and `ingest/lib/db_schema.py` `ALTER` the `chunks.embedding` column on connect. Keep the two in sync when changing it.
- `EMBEDDING_DIMENSIONS` mismatch is a top source of "no quotes found" — check the Status page (DB chunk count, LLM/Embeddings connection).
- `docker compose down -v` wipes `pgdata` and `ingestdata` volumes → must re-download and re-ingest. Prefer not to use `-v` casually.

## Architecture / wiring

- `@/*` alias in `app/tsconfig.json` maps to the `app/` directory root, so `@/lib/search` = `app/lib/search.ts`.
- Search pipeline (`app/app/api/search/route.ts` → `app/lib/search.ts`): LLM query decomposition (`decomposeQuery`) → multi-vector pgvector cosine search (one embedding per decomposed query, unioned; `SEARCH_MIN_SIMILARITY`, default 0.15) + FTS keyword fallback → LLM extracts verbatim quotes → fuzzy `validateQuotesAgainstChunks` (in `app/lib/validation.ts`, ~0.7 overlap, stopwords stripped) filters hallucinations. 20 req/min IP rate limit in the route.
- `app/next.config.js` sets `output: 'standalone'`; `Dockerfile.web` copies `node_modules` separately because the standalone bundle omits native `pg`/`pgvector`.
- Ingest scripts import helpers via `sys.path.insert(0, ../lib)` → `from llm import`, `from db_schema import`, `from db import` (see `ingest/scripts/ingest_scriptures.py:3-7`).
- Conference download uses Playwright (Chromium installed in `Dockerfile.ingest`); other downloads use requests + BeautifulSoup.

## Gotchas

- `validateQuotesAgainstChunks` is active in `app/lib/search.ts` using the fuzzy word-overlap version (not strict substring). It was previously commented out (git `70d09a9`) because strict matching dropped valid quotes; keep the fuzzy version enabled.
- Zod enums in LLM response parsing were loosened to `z.string()` to avoid silent failures (git `70d09a9`).
- Keep `EMBEDDING_DIMENSIONS`, `.env.example`, `db/init/01-schema.sql`, `app/lib/db.ts`, and `ingest/lib/db_schema.py` consistent with each other.
