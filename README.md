# Gospel Study Assistant

A self-hosted scripture study tool for LDS families. Returns **direct quotes only** from Church-approved sources — no AI summaries or interpretations.

## Architecture

- **Frontend:** Next.js 14 (App Router)
- **Database:** PostgreSQL 16 + pgvector (semantic search)
- **AI:** OpenAI-compatible API endpoints (LLM + embeddings)
- **Auth:** Single shared family password
- **Deployment:** Docker Compose (web, db, ingest)

## Prerequisites

- Docker + Docker Compose
- An AI server with OpenAI-compatible endpoints:
  - `/v1/chat/completions` — quote extraction during search
  - `/v1/embeddings` — vector search
- Internet access for initial data downloads

## Setup from Scratch

### 1. Clone and configure

```bash
git clone <repo-url> gospel-study-assistant
cd gospel-study-assistant
cp .env.example .env
```

### 2. Edit `.env`

```bash
# Database (leave defaults)
DATABASE_URL=postgresql://gospel:gospelpass@db:5432/gospel_db

# LLM endpoint (chat completions)
LLM_BASE_URL=http://your-ai-server:8000/v1
LLM_API_KEY=your-key-if-needed
LLM_MODEL=your-model-name

# Embedding endpoint (vector embeddings)
EMBEDDING_BASE_URL=http://your-ai-server:8000/v1
EMBEDDING_API_KEY=your-key-if-needed
EMBEDDING_MODEL=your-embedding-model-name
EMBEDDING_DIMENSIONS=4096

# Authentication
FAMILY_SHARED_SECRET=your-family-password
NEXTAUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=http://your-server-ip:3000
```

**Important:**
- `EMBEDDING_DIMENSIONS` must match your model's actual output (768, 1024, 4096, etc.)
- `NEXTAUTH_URL` must match how users access the site (e.g. `http://192.168.86.169:3000`)
- `FAMILY_SHARED_SECRET` can be plain text or a bcrypt hash

### 3. Build and start

```bash
docker compose build --no-cache
docker compose up -d
```

Use `--no-cache` on first build and after code changes.

### 4. Load data

Run these commands in order on your server:

```bash
# Step 1: Download scriptures (OT, NT, BoM, D&C, PoGP) — ~30s
docker compose run --rm ingest python -m scripts.run_ingest download_bible

# Step 2: Ingest scriptures into database — ~5-10 min
docker compose run --rm ingest python -m scripts.run_ingest scripture

# Step 3 (optional): Download supplementary content — ~10-20 min
docker compose run --rm ingest python -m scripts.run_ingest download_supplementary

# Step 4 (optional): Ingest supplementary content — ~5-10 min
docker compose run --rm ingest python -m scripts.run_ingest supplementary
```

**Note:** The ingest container uses a Docker volume (`ingestdata`) so downloaded files persist between runs.

### 5. Verify and search

1. Open `http://your-server-ip:3000`
2. Log in with your family password
3. Go to **Status** to verify: DB shows chunks, LLM shows Connected, Embeddings shows Connected
4. Go to **Search** and ask a question

## Available Ingestion Commands

| Command | Description |
|---------|-------------|
| `download_bible` | Download scriptures from GitHub |
| `download_conference` | Download General Conference talks |
| `download_supplementary` | Download CFM manuals, BYU devotionals, Gospel Topics |
| `download_all` | Download everything above |
| `scripture` | Ingest scriptures into database |
| `conference` | Ingest conference talks into database |
| `supplementary` | Ingest supplementary content into database |
| `all` | Ingest everything (scripture + supplementary + conference) |

Run as: `docker compose run --rm ingest python -m scripts.run_ingest <command>`

## Troubleshooting

### "No quotes found" on search
Go to the **Status** page:
- If **Database** shows 0 chunks → run the ingestion commands above
- If **LLM** or **Embeddings** shows Disconnected → check your AI server is running and `.env` URLs are correct

### Port 3000 already in use
```bash
lsof -i :3000
```
Either kill that process or change `docker-compose.yml` to `ports: - "3001:3000"`.

### Need to reset the database (schema changes)
```bash
docker compose down -v
docker compose up -d
```
This destroys and recreates all volumes (you'll need to re-ingest data).

## Disclaimer

This is not an official Church product. The Church of Jesus Christ of Latter-day Saints does not endorse this application.
