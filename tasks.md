# Gospel Study Assistant — Audit Remediation & Enhancement Tasks

This document contains a comprehensive, prioritized checklist of tasks to harden, optimize, and enhance the **Gospel Study Assistant** codebase. Each task includes clear context, target file paths, step-by-step instructions, code templates, and acceptance criteria designed so an autonomous local model can execute each task reliably.

---

## Task Summary & Progress Tracker

### Phase 1: Security & Authentication Hardening
- [x] **Task 1.1**: Implement timing-safe password comparison in `app/lib/auth.ts`
- [x] **Task 1.2**: Implement in-memory rate limiting on `/api/search` in `app/app/api/search/route.ts`

### Phase 2: RAG Accuracy & Hallucination Safeguards
- [x] **Task 2.1**: Implement fuzzy n-gram quote validation in `app/lib/validation.ts` and re-enable in `app/lib/search.ts`

### Phase 3: Database Schema & Migration Consistency
- [x] **Task 3.1**: Standardize embedding dimensions default and documentation in `db/init/01-schema.sql` and `.env.example`
- [x] **Task 3.2**: Refactor and deduplicate schema initialization in `ingest/scripts/` and `app/lib/db.ts`

### Phase 4: Search Quality & Retrieval Enhancements
- [x] **Task 4.1**: Expand the `QUERY_EXPANSIONS` dictionary in `app/lib/search.ts` with doctrinal & theological terms
- [x] **Task 4.2**: Add token/character budget limits to `buildUserPrompt` in `app/lib/search.ts`

---

## Phase 1: Security & Authentication Hardening

### Task 1.1: Implement Timing-Safe Password Comparison
* **Priority**: High
* **Difficulty**: Low
* **Target File**: `app/lib/auth.ts`

#### Background & Motivation
Currently, when `FAMILY_SHARED_SECRET` is stored as plaintext (i.e., not starting with `$2` for bcrypt), the comparison in `app/lib/auth.ts` uses standard JavaScript string equality (`inputPassword === sharedSecret`). Standard equality checks short-circuit on the first mismatched character, creating a timing side-channel that could allow an attacker to infer password length and characters over the network.

#### Detailed Instructions
1. Open `app/lib/auth.ts`.
2. Import `timingSafeEqual` from Node's built-in `crypto` module at the top of the file.
3. Replace the plaintext comparison block with a timing-safe Buffer comparison.
4. Ensure that buffers of unequal length are handled without throwing an error (length check must occur before calling `timingSafeEqual`).

#### Implementation Template
```typescript
import { compare } from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import CredentialsProvider from 'next-auth/providers/credentials';
import NextAuth from 'next-auth';

// ... existing code ...

      async authorize(credentials) {
        if (!credentials?.password) return null;
        if (!sharedSecret) return null;

        const inputPassword = credentials.password as string;

        if (sharedSecret.startsWith('$2')) {
          const valid = await compare(inputPassword, sharedSecret);
          if (!valid) return null;
        } else {
          // Timing-safe comparison for plaintext shared secret
          const inputBuffer = Buffer.from(inputPassword, 'utf8');
          const secretBuffer = Buffer.from(sharedSecret, 'utf8');

          if (inputBuffer.length !== secretBuffer.length) {
            return null;
          }

          if (!timingSafeEqual(inputBuffer, secretBuffer)) {
            return null;
          }
        }

        return { id: 'family', name: 'Family' };
      },
```

#### Acceptance Criteria
- [ ] Logging in with the correct `FAMILY_SHARED_SECRET` succeeds.
- [ ] Logging in with an incorrect password of different length fails cleanly and returns `null`.
- [ ] Logging in with an incorrect password of the same length fails cleanly and returns `null`.
- [ ] Bcrypt hash passwords starting with `$2` continue to work as expected.

---

### Task 1.2: Implement In-Memory Rate Limiting on `/api/search`
* **Priority**: High
* **Difficulty**: Medium
* **Target File**: `app/app/api/search/route.ts`

#### Background & Motivation
The `/api/search` endpoint executes expensive operations:
1. Calling an external embedding API (`/v1/embeddings`).
2. Executing a pgvector cosine similarity search in PostgreSQL.
3. Calling an LLM completion API (`/v1/chat/completions`).

Without rate limiting, automated requests or accidental loops can saturate the AI server, leading to denial of service or excessive resource consumption.

#### Detailed Instructions
1. Open `app/app/api/search/route.ts`.
2. Create an in-memory sliding-window or token-bucket rate limiter map keyed by IP address or session identifier (extractable from `req.headers.get('x-forwarded-for') || 'default'`).
3. Set a limit of **20 search requests per minute per client**.
4. If a client exceeds the limit, return an HTTP `429 Too Many Requests` JSON response with a clear error message.

#### Implementation Template
```typescript
import { NextResponse } from 'next/server';
import { search } from '@/lib/search';

// Simple in-memory sliding window rate limiter
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20;
const ipRequestCounts = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRequestCounts.set(ip, { count: 1, windowStart: now });
    return false;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  record.count += 1;
  return false;
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'default-client';
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment before searching again.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { query, filters } = body;
// ... rest of existing handler ...
```

#### Acceptance Criteria
- [ ] Standard search requests under 20 requests per minute succeed with HTTP `200`.
- [ ] Sending more than 20 requests within 60 seconds from the same IP returns HTTP `429 Too Many Requests` with `{ error: "Too many requests..." }`.
- [ ] Waiting 60 seconds resets the window and allows new requests.

---

## Phase 2: RAG Accuracy & Hallucination Safeguards

### Task 2.1: Implement Fuzzy N-Gram Quote Validation & Re-Enable Validator
* **Priority**: High
* **Difficulty**: Medium
* **Target Files**:
  - `app/lib/validation.ts`
  - `app/lib/search.ts`

#### Background & Motivation
In `app/lib/search.ts` (lines 301–306), the call to `validateQuotesAgainstChunks` was commented out because strict substring matching dropped valid quotes when the LLM made minor formatting or punctuation adjustments (e.g., changing curly quotes to straight quotes, adding ellipses, or standardizing whitespace).

However, removing validation entirely allows local LLMs to occasionally hallucinate plausible-sounding scripture verses that do not appear in the retrieved context.

#### Detailed Instructions
1. Open `app/lib/validation.ts`.
2. Replace or update `validateQuotesAgainstChunks` with a **fuzzy n-gram / word-overlap similarity verifier**:
   - Normalize both the quote and chunk texts (lowercase, remove punctuation, collapse extra whitespace).
   - Require that at least **80% of the significant words (3+ characters)** in the LLM quote appear in order or with high overlap within at least one context chunk.
3. Open `app/lib/search.ts`.
4. Uncomment and update lines 301–306 to invoke the improved `validateQuotesAgainstChunks` before returning quotes.
5. Add console logging when a quote is rejected so administrators can monitor potential hallucinations.

#### Implementation Template (`app/lib/validation.ts`)
```typescript
export function validateQuotesAgainstChunks(
  quotes: Quote[],
  chunks: Array<{ text: string }>
): Quote[] {
  return quotes.filter((quote) => {
    // Clean and tokenize quote into significant words
    const cleanQuoteWords = quote.quote
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Very short quotes (< 3 significant words) pass automatically
    if (cleanQuoteWords.length < 3) return true;

    // Check if any chunk has at least an 80% word match
    return chunks.some((chunk) => {
      const cleanChunkText = chunk.text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ');

      const chunkWordsSet = new Set(cleanChunkText.split(/\s+/));
      let matchCount = 0;

      for (const word of cleanQuoteWords) {
        if (chunkWordsSet.has(word)) {
          matchCount++;
        }
      }

      const matchRatio = matchCount / cleanQuoteWords.length;
      return matchRatio >= 0.8;
    });
  });
}
```

#### Implementation Template (`app/lib/search.ts`)
```typescript
  // In search() function around line 300:
  const beforeCount = parsed.quotes.length;
  parsed.quotes = validateQuotesAgainstChunks(parsed.quotes, chunks);
  const afterCount = parsed.quotes.length;

  if (beforeCount !== afterCount) {
    console.log(
      `[Search] Hallucination guard: Filtered ${beforeCount - afterCount} unverified quote(s)`
    );
  }
```

#### Acceptance Criteria
- [ ] Verbatim quotes extracted from chunks pass validation.
- [ ] Quotes with minor punctuation differences (commas, quotes, ellipses) pass validation.
- [ ] Completely fabricated or hallucinated sentences that share few words with the context chunks are stripped from `parsed.quotes`.
- [ ] Console logs `[Search] Hallucination guard: Filtered X unverified quote(s)` when invalid quotes are rejected.

---

## Phase 3: Database Schema & Migration Consistency

### Task 3.1: Standardize Embedding Dimensions Default & Documentation
* **Priority**: Medium
* **Difficulty**: Low
* **Target Files**:
  - `db/init/01-schema.sql`
  - `.env.example`

#### Background & Motivation
- `.env.example` lists `EMBEDDING_DIMENSIONS=4096`.
- `01-schema.sql` defines `embedding vector(1024)`.
- When PostgreSQL initializes from `01-schema.sql`, it creates a `1024`-dimensional column. At runtime, application and ingest scripts check `atttypmod` and alter the column to match `EMBEDDING_DIMENSIONS`. To prevent confusion and startup delays, the default schema and `.env.example` should align cleanly.

#### Detailed Instructions
1. Open `db/init/01-schema.sql`.
2. Add a clear header comment above table creation explaining how `EMBEDDING_DIMENSIONS` interacts with `vector(1024)`.
3. Ensure `.env.example` documents supported dimension sizes (`768` for Nomic/BERT, `1024` for bge-large, `4096` for Qwen/Ollama models) with explanatory comments.

#### Acceptance Criteria
- [ ] Comments in `01-schema.sql` clearly explain column dimension alteration behavior.
- [ ] `.env.example` provides explicit examples for `EMBEDDING_DIMENSIONS` matching common local/remote embedding models.

---

### Task 3.2: Consolidate Database Schema Initialization Helpers
* **Priority**: Medium
* **Difficulty**: Medium
* **Target Files**:
  - `ingest/scripts/ingest_scriptures.py`
  - `ingest/scripts/ingest_supplementary.py`
  - `app/lib/db.ts`

#### Background & Motivation
The SQL queries to check constraints (`sources_slug_key`, `documents_title_key`), alter `embedding` dimensions, and create the `IVFFlat` vector index are duplicated verbatim across `ingest_scriptures.py`, `ingest_supplementary.py`, and `app/lib/db.ts`.

#### Detailed Instructions
1. Create a shared Python helper module in `ingest/lib/db_schema.py` containing a single `ensure_schema(cur)` function.
2. Replace `ensure_schema` in `ingest_scriptures.py` and `ingest_supplementary.py` with an import from `lib.db_schema`.
3. In `app/lib/db.ts`, wrap index creation in `CREATE INDEX IF NOT EXISTS` and ensure error handling gracefully logs without crashing if another process is concurrently creating the index.

#### Implementation Template (`ingest/lib/db_schema.py`)
```python
import os
import logging

logger = logging.getLogger(__name__)
_schema_ensured = False

def ensure_schema(cur):
    """Ensure required constraints and vector indexes exist."""
    global _schema_ensured
    if _schema_ensured:
        return

    cur.execute("SELECT 1 FROM pg_constraint WHERE conname = 'sources_slug_key'")
    if not cur.fetchone():
        cur.execute("ALTER TABLE sources ADD CONSTRAINT sources_slug_key UNIQUE (slug)")

    cur.execute("SELECT 1 FROM pg_constraint WHERE conname = 'documents_title_key'")
    if not cur.fetchone():
        cur.execute("ALTER TABLE documents ADD CONSTRAINT documents_title_key UNIQUE (title)")

    embedding_dims = int(os.environ.get('EMBEDDING_DIMENSIONS', '1024'))
    cur.execute("""
        SELECT atttypmod FROM pg_attribute
        WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'
    """)
    row = cur.fetchone()
    if row and row[0] == -1:
        logger.info(f"Altering embedding column to vector({embedding_dims})...")
        cur.execute(f"ALTER TABLE chunks ALTER COLUMN embedding TYPE vector({embedding_dims})")

    cur.execute("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_chunks_embedding'")
    if not cur.fetchone():
        try:
            logger.info("Creating IVFFlat index on chunks.embedding...")
            cur.execute("""
                CREATE INDEX idx_chunks_embedding ON chunks 
                USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
            """)
        except Exception as e:
            logger.warning(f"Index creation failed (will use seq scan): {e}")

    _schema_ensured = True
```

#### Acceptance Criteria
- [ ] Both `ingest_scriptures.py` and `ingest_supplementary.py` import and call `ensure_schema` from `db_schema.py`.
- [ ] Running ingestion commands (`python -m scripts.run_ingest scripture`) executes without schema errors.

---

## Phase 4: Search Quality & Retrieval Enhancements

### Task 4.1: Expand Doctrinal & Theological Synonym Dictionary
* **Priority**: Medium
* **Difficulty**: Low
* **Target File**: `app/lib/search.ts`

#### Background & Motivation
Currently, `QUERY_EXPANSIONS` in `app/lib/search.ts` only contains 24 psychological/mental health keywords (`anxiety`, `ocd`, `burnout`, etc.). Adding core Latter-day Saint theological and doctrinal terms improves embedding search recall for scriptural study queries.

#### Detailed Instructions
1. Open `app/lib/search.ts`.
2. Expand the `QUERY_EXPANSIONS` object with additional doctrinal terms (e.g., `grace`, `atonement`, `covenant`, `temple`, `priesthood`, `tithing`, `sabbath`, `repentance`, `revelation`, `sacrament`).
3. Maintain lowercase keys and descriptive synonym arrays.

#### Implementation Template
```typescript
const QUERY_EXPANSIONS: Record<string, string[]> = {
  // Existing mental health terms...
  scrupulosity: ['anxiety about sin', 'fear of wrongdoing', 'overly conscientious', 'peace of mind', 'religious anxiety'],
  ocd: ['obsessive thoughts', 'compulsion', 'repetition', 'peace of mind', 'control thoughts', 'worry'],
  anxiety: ['fear', 'worry', 'peace', 'trust', 'comfort', 'strength', 'calm', 'anxious'],
  // ... existing terms ...

  // Core LDS Doctrinal & Theological Expansions
  grace: ['mercy', 'enabling power', 'redemption', 'gift of god', 'favor', 'jesus christ', 'salvation'],
  atonement: ['sacrifice', 'redemption', 'jesus christ', 'reconciliation', 'forgiveness', 'resurrection', 'healing'],
  covenant: ['promise', 'binding agreement', 'ordinance', 'sacred obligation', 'baptism', 'temple', 'faithfulness'],
  temple: ['house of the lord', 'holy place', 'endowment', 'sealing', 'covenants', 'ordinances', 'eternal family'],
  priesthood: ['power of god', 'authority', 'keys', 'ordinances', 'melchizedek', 'aaronic', 'service'],
  tithing: ['tenth', 'consecration', 'offerings', 'blessings of heaven', 'windows of heaven', 'sacrifice'],
  sabbath: ['holy day', 'day of rest', 'sacrament', 'worship', 'delight', 'keep holy'],
  repentance: ['change of heart', 'turn to god', 'forgiveness', 'confess', 'forsake', 'mercy'],
  revelation: ['holy ghost', 'inspiration', 'spirit', 'still small voice', 'guidance', 'personal revelation'],
  sacrament: ['remembrance', 'bread and water', 'covenant', 'body and blood', 'renew covenants'],
};
```

#### Acceptance Criteria
- [ ] Searching for `"what do scriptures say about grace"` logs expanded terms (`mercy`, `enabling power`, `redemption`) in console output: `[Search] Query expanded: ...`.
- [ ] Search recall for doctrinal terms returns relevant Bible, Book of Mormon, and Conference talk passages.

---

### Task 4.2: Add Token/Character Budget Protection to Prompt Builder
* **Priority**: Medium
* **Difficulty**: Low
* **Target File**: `app/lib/search.ts`

#### Background & Motivation
In `buildUserPrompt` (`app/lib/search.ts`), up to 15 chunks are appended to the user prompt. If chunk sizes in the database are large, the prompt can exceed the local model's context window (causing truncation or API `context_length_exceeded` errors).

#### Detailed Instructions
1. Open `app/lib/search.ts`.
2. Define a maximum character budget for the context block (e.g., `24000` characters, equivalent to approx. `6000` tokens).
3. In `buildUserPrompt`, track cumulative characters added. Stop appending further chunks once the budget is reached.

#### Implementation Template
```typescript
const MAX_CONTEXT_CHARS = 24000; // ~6000 tokens

export function buildUserPrompt(
  query: string,
  chunks: Array<{
    text: string;
    source: string;
    reference: string;
    source_type: string;
    official_status: string;
    doctrinal_weight: string;
    content_category: string;
  }>
): string {
  let prompt = `USER QUERY: ${query}\n\n`;
  prompt += `CONTEXT CHUNKS:\n\n`;

  let totalChars = 0;
  let includedChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkSection =
      `--- CHUNK ${i + 1} ---\n` +
      `Source: ${chunk.source}\n` +
      `Reference: ${chunk.reference}\n` +
      `Type: ${chunk.source_type} | Status: ${chunk.official_status} | Weight: ${chunk.doctrinal_weight} | Category: ${chunk.content_category}\n` +
      `Text: ${chunk.text}\n\n`;

    if (totalChars + chunkSection.length > MAX_CONTEXT_CHARS && includedChunks > 0) {
      console.log(
        `[Search] Reached max context character budget (${MAX_CONTEXT_CHARS}). Included ${includedChunks}/${chunks.length} chunks.`
      );
      break;
    }

    prompt += chunkSection;
    totalChars += chunkSection.length;
    includedChunks++;
  }

  prompt += `\nExtract all relevant quotes from the chunks above that relate to the user's query. Return up to 20 quotes. Be generous in what you consider relevant. If no relevant quotes exist, set no_results to true.`;
  return prompt;
}
```

#### Acceptance Criteria
- [ ] Queries with 15 large chunks cleanly cap the prompt around `24,000` characters without throwing context length errors.
- [ ] Console logs a notification when chunks are omitted due to the character budget.
- [ ] At least 1 chunk is always included even if its text exceeds the character budget.
