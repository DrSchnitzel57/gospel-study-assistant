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
EMBEDDING_DIMENSIONS=768

# Authentication
FAMILY_SHARED_SECRET=your-family-password
NEXTAUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=http://your-server-ip:3000
```

**Important:**
- `EMBEDDING_DIMENSIONS` must match your model's output (768, 1024, 4096, etc.)
- `NEXTAUTH_URL` must match how users access the site (e.g. `http://192.168.86.169:3000`)
- `FAMILY_SHARED_SECRET` can be plain text or a bcrypt hash

### 3. Build and start

```bash
docker compose build --no-cache
docker compose up -d
```

Use `--no-cache` on first build and after code changes.

### 4. Load data via the web UI

1. Open `http://your-server-ip:3000` in a browser
2. Log in with your family password
3. Navigate to **Status & Ingestion** (in the top nav)
4. Click the buttons in order:
   - **Download Scriptures** → downloads OT, NT, BoM, D&C, PoGP (~30s)
   - **Ingest Scriptures** → chunks and embeds into database (~5-10 min)
   - **Download Supplementary** → scrapes conference, manuals, devotionals (~10-20 min)
   - **Ingest Supplementary** → chunks and embeds supplementary content (~5-10 min)

Data persists across restarts via Docker volumes.

### 5. Start searching

Go to the **Search** page and ask a question. Results are direct quotes with source citations.

## CLI Alternative (Optional)

You can also run ingestion from the terminal:

```bash
# Download scriptures
docker compose run --rm ingest python -m scripts.run_ingest download_bible

# Ingest scriptures into database
docker compose run --rm ingest python -m scripts.run_ingest scripture

# Download supplementary content
docker compose run --rm ingest python -m scripts.run_ingest download_supplementary

# Ingest supplementary content
docker compose run --rm ingest python -m scripts.run_ingest supplementary
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start all services |
| `docker compose down` | Stop all services |
| `docker compose build --no-cache web` | Rebuild web app |
| `docker compose logs -f web` | Watch web app logs |
| `docker compose logs -f db` | Watch database logs |

## Troubleshooting

### "Server Error" on login
```bash
docker compose build --no-cache web
docker compose up -d web
```

### "No quotes found" on search
Check the **Status** page:
- If **Database** shows 0 chunks → run ingestion (Step 4 above)
- If **LLM** or **Embeddings** shows Disconnected → check your AI server is running and `.env` URLs are correct

### Port 3000 already in use
```bash
lsof -i :3000
```
Either kill that process or change `docker-compose.yml` to `ports: - "3001:3000"`.

### Embedding dimension mismatch
Verify your model's actual output:
```bash
docker compose run --rm ingest python -c "
from lib.llm import get_embedding
e = get_embedding('test')
print(f'Dimensions: {len(e)}')
"
```
Then update `EMBEDDING_DIMENSIONS` in `.env` to match.

## Disclaimer

This is not an official Church product. The Church of Jesus Christ of Latter-day Saints does not endorse this application.
