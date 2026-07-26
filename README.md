# Gospel Study Assistant

A self-hosted scripture study tool for LDS families. Returns **direct quotes only** from Church-approved sources — no AI summaries or interpretations.

## Architecture

- **Frontend:** Next.js 14 (App Router)
- **Database:** PostgreSQL 16 + pgvector (semantic search)
- **AI:** OpenAI-compatible API endpoints (LLM for quote extraction, embedding model for search)
- **Auth:** Single shared family password (no user database)
- **Deployment:** Docker Compose (3 services: web, db, ingest)

## Prerequisites

- Docker + Docker Compose installed on your server
- An AI server with OpenAI-compatible endpoints for:
  - Chat completions (`/v1/chat/completions`) — for extracting quotes from search results
  - Embeddings (`/v1/embeddings`) — for vector search
- Internet access (for downloading scriptures and supplementary content)

## Quick Start

### 1. Clone and configure

```bash
git clone <repo-url> gospel-study-assistant
cd gospel-study-assistant
cp .env.example .env
```

### 2. Edit `.env`

```bash
# Database (leave defaults unless changing docker-compose.yml)
DATABASE_URL=postgresql://gospel:gospelpass@db:5432/gospel_db

# LLM endpoint (chat completions — used for quote extraction during search)
LLM_BASE_URL=http://your-ai-server:8000/v1
LLM_API_KEY=your-key-if-needed
LLM_MODEL=your-model-name

# Embedding endpoint (vector embeddings — used for ingestion and search)
EMBEDDING_BASE_URL=http://your-ai-server:8000/v1
EMBEDDING_API_KEY=your-key-if-needed
EMBEDDING_MODEL=your-embedding-model-name
EMBEDDING_DIMENSIONS=768

# Authentication
FAMILY_SHARED_SECRET=your-family-password
NEXTAUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=http://your-server-ip:3000
```

**Important notes:**
- `EMBEDDING_DIMENSIONS` must match your embedding model's output (e.g., 768 for nomic-embed-text, 1024 for text-embedding-3-small, 4096 for some models)
- `NEXTAUTH_URL` must match the URL users will use to access the site
- `FAMILY_SHARED_SECRET` can be plain text or a bcrypt hash

### 3. Build and start

```bash
docker compose build --no-cache
docker compose up -d
```

The `--no-cache` flag is important on first build and after any code changes to ensure all dependencies are included.

### 4. Access the application

Open `http://your-server-ip:3000` in a browser. Enter your family password to log in.

## Ingesting Data

The ingest container downloads and processes content into the database. Run these commands in order:

### Step 1: Download source content

```bash
# Download scriptures (OT, NT, Book of Mormon, D&C, Pearl of Great Price)
docker compose run --rm ingest python -m scripts.run_ingest download_bible

# Download supplementary content (conference talks, manuals, devotionals, etc.)
docker compose run --rm ingest python -m scripts.run_ingest download_supplementary
```

### Step 2: Ingest into database

```bash
# Ingest scriptures (chunks, embeds, stores in PostgreSQL)
docker compose run --rm ingest python -m scripts.run_ingest scripture

# Ingest supplementary content
docker compose run --rm ingest python -m scripts.run_ingest supplementary
```

### Or run everything at once

```bash
# Downloads + ingests everything
docker compose run --rm ingest python -m scripts.run_ingest download_all
docker compose run --rm ingest python -m scripts.run_ingest all
```

**Note:** Scripture ingestion takes several minutes (224 books, thousands of chunks). Supplementary ingestion takes longer (scrapes websites via Playwright).

## Available Commands

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start all services |
| `docker compose down` | Stop all services |
| `docker compose build --no-cache web` | Rebuild the web app |
| `docker compose build --no-cache ingest` | Rebuild the ingest container |
| `docker compose logs -f web` | View web app logs |
| `docker compose logs -f db` | View database logs |
| `docker compose run --rm ingest python -m scripts.run_ingest scripture` | Re-ingest scriptures |

## Troubleshooting

### "Server Error" on login
Rebuild the web container with `--no-cache`:
```bash
docker compose build --no-cache web
docker compose up -d web
```

### Port 3000 already in use
Check what's using it:
```bash
lsof -i :3000
```
Either stop that service or change the port mapping in `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"
```

### Embedding dimension mismatch
If you see errors about vector dimensions, check that `EMBEDDING_DIMENSIONS` in `.env` matches your embedding model's actual output. You can verify by running:
```bash
docker compose run --rm ingest python -c "
from lib.llm import get_embedding
e = get_embedding('test')
print(f'Dimensions: {len(e)}')
"
```

### Ingest container fails with "module not found"
Rebuild with `--no-cache`:
```bash
docker compose build --no-cache ingest
```

## Project Structure

```
├── app/                    # Next.js application
│   ├── app/                # App Router (pages, API routes)
│   │   ├── api/            # API endpoints
│   │   ├── login/          # Login page
│   │   ├── search/         # Search page
│   │   └── history/        # Church history guide
│   ├── components/         # React components
│   ├── lib/                # Shared utilities (db, llm, auth, search)
│   └── middleware.ts       # Auth middleware
├── ingest/                 # Python ingestion pipeline
│   ├── scripts/            # Download and ingestion scripts
│   └── lib/                # Shared Python utilities
├── db/
│   └── init/               # PostgreSQL schema + seed data
├── Dockerfile.web          # Next.js container
├── Dockerfile.ingest       # Python ingestion container
└── docker-compose.yml      # 3 services: web, db, ingest
```

## Disclaimer

This is not an official Church product. The Church of Jesus Christ of Latter-day Saints does not endorse this application.
