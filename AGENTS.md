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
- `download_conference` accepts years: `download_conference 2018-2025`, `download_conference 2015,2018,2020`, or `all`. With no arg and a TTY it prompts interactively (use `docker compose run -it --rm ingest ...`).

## Setup / environment

- `.env` is required and gitignored; copy `.env.example`. `DATABASE_URL` uses host `db` (docker network).
- `EMBEDDING_DIMENSIONS` must match your model's output and is **applied at runtime**: schema defaults to `vector(1024)`, but both `app/lib/db.ts:19` and `ingest/lib/db_schema.py` `ALTER` the `chunks.embedding` column on connect. Keep the two in sync when changing it.
- `EMBEDDING_DIMENSIONS` mismatch is a top source of "no quotes found" — check the Status page (DB chunk count, LLM/Embeddings connection).
- Reasoning models (Qwen3.x, default `LLM_ENABLE_THINKING=true`) spend output budget on thinking tokens; if `LLM_MAX_TOKENS` is too low the extraction JSON gets truncated and the UI shows "no quotes found". `search.ts` retries once with thinking disabled on parse failure. If it still fails, look for `[Search] ... failed validation` + tail in web logs.
- `docker compose down -v` wipes `pgdata` only — downloads now live in `./ingest/data` on the host and survive deletion of the volumes. Prefer not to use `-v` casually.

## Architecture / wiring

- `@/*` alias in `app/tsconfig.json` maps to the `app/` directory root, so `@/lib/search` = `app/lib/search.ts`.
- Search pipeline (`app/app/api/search/route.ts` → `app/lib/search.ts`): category-aware LLM query decomposition (`decomposeQuery`, `SEARCH_MAX_DECOMPOSED_QUERIES`=10; prompt forces literal/doctrinal/pastoral/scripture-narrative facets and scripture-idiom phrasing) → multi-vector pgvector cosine search (one embedding per decomposed query, unioned; `SEARCH_MIN_SIMILARITY`, default 0.15) + **FTS keyword fallback on every decomposed query** → per-category **rescue floor** (`rescueWeakCategories`: any selected category under `SEARCH_MIN_CHUNKS_PER_CATEGORY`=2 chunks gets a category-scoped vector pass at `SEARCH_CATEGORY_MIN_SIMILARITY` (half the main threshold) plus a keyword pass) → `selectDiverseChunks` round-robins context across selected categories (≤`SEARCH_MAX_CHUNKS_PER_DOCUMENT`=3 chunks/source) → LLM extracts verbatim quotes → fuzzy `annotateAndValidateQuotes` (`app/lib/validation.ts`, ~0.55 overlap, stopwords stripped) drops hallucinations and stamps each quote with the matched chunk's authoritative source/category → `diversifyQuotes` caps quotes at `SEARCH_MAX_QUOTES_PER_SOURCE`=3/source with a `SEARCH_MIN_QUOTES_PER_CATEGORY`=2 minimum per selected category (`SEARCH_MAX_QUOTES`=20 default). Category metadata lives once in `app/lib/categories.ts`. 20 req/min IP rate limit in the route.
- `app/next.config.js` sets `output: 'standalone'`; `Dockerfile.web` copies `node_modules` separately because the standalone bundle omits native `pg`/`pgvector`.
- The ingest host dir `./ingest/data` is bind-mounted into the ingest container at `/app/data` (read-write) and into the `web` container at `/app/ingestdata` (read-only) so the Status page (`app/app/status/page.tsx`, fed by `app/app/api/status/route.ts`) can compare downloaded files on disk vs `documents`/`chunks` rows (per `content_category`). The only scripture subdir is `data/scriptures/` (not `scripts/`). Override the scan path locally via `INGEST_DATA_DIR`.
- `docker compose down -v` wipes `pgdata` only — downloads now live in `./ingest/data` on the host and survive deletion of the volumes.
- Ingest scripts import helpers via `sys.path.insert(0, ../lib)` → `from llm import`, `from db_schema import`, `from db import` (see `ingest/scripts/ingest_scriptures.py:3-7`).
- Conference download uses Playwright (Chromium installed in `Dockerfile.ingest`); other downloads use requests + BeautifulSoup.

## Gotchas

- `annotateAndValidateQuotes` is active in `app/lib/search.ts` using the fuzzy word-overlap version (~0.55, stopwords stripped), replacing the older boolean-only `validateQuotesAgainstChunks`. It was previously commented out (git `70d09a9`) because strict matching dropped valid quotes; keep the fuzzy version enabled.
- Zod enums in LLM response parsing were loosened to `z.string()` to avoid silent failures (git `70d09a9`).
- Keep `EMBEDDING_DIMENSIONS`, `.env.example`, `db/init/01-schema.sql`, `app/lib/db.ts`, and `ingest/lib/db_schema.py` consistent with each other.
