import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import path from 'path';
import pool from '@/lib/db';
import { getConfig } from '@/lib/llm';

// Read-only mount of the ingest volume (see docker-compose.yml). Inside Docker
// this is /app/ingestdata; override for local (non-container) development.
const INGEST_DATA_DIR = process.env.INGEST_DATA_DIR || '/app/ingestdata';

// Subdirectories inside the ingest volume correspond to a content_category.
const DOWNLOAD_SOURCES = [
  { key: 'scripture', label: 'Scriptures (OT, NT, BoM, D&C, PoGP)', dir: 'scriptures' },
  { key: 'conference', label: 'General Conference', dir: 'conference' },
  { key: 'manual', label: 'Come, Follow Me Manuals', dir: 'manuals' },
  { key: 'devotional', label: 'BYU Devotionals', dir: 'devotionals' },
  { key: 'history', label: 'Gospel Topics / Church History', dir: 'history' },
];

async function countTxtFiles(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return -1;
  }
  let count = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countTxtFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.txt')) {
      count += 1;
    }
  }
  return count;
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const config = getConfig();

  const status: {
    db: { connected: boolean; chunks: number; documents: number; categories: Record<string, number>; lastIngested: string | null; vectorDimensions: number | null; error?: string };
    llm: { connected: boolean; model: string; baseUrl: string; pingTime: number | null; enableThinking: boolean; maxTokens: number; urlIsFallback: boolean; error?: string };
    embedding: { connected: boolean; model: string; baseUrl: string; dimensions: number; pingTime: number | null; urlIsFallback: boolean; error?: string };
    download: { mounted: boolean; sources: Array<{ key: string; label: string; dir: string; files: number; documents: number; chunks: number }> };
  } = {
    db: { connected: false, chunks: 0, documents: 0, categories: {}, lastIngested: null, vectorDimensions: null },
    llm: { connected: false, model: config.llmModel, baseUrl: config.llmBaseUrl, pingTime: null, enableThinking: config.llmEnableThinking, maxTokens: config.llmMaxTokens, urlIsFallback: config.llmUrlIsFallback },
    embedding: { connected: false, model: config.embeddingModel, baseUrl: config.embeddingBaseUrl, dimensions: config.embeddingDimensions, pingTime: null, urlIsFallback: config.embeddingUrlIsFallback },
    download: { mounted: false, sources: [] },
  };

  const chunksPerCategory = new Map<string, number>();
  const documentsPerCategory = new Map<string, number>();

  try {
    const chunkCount = await pool.query('SELECT COUNT(*) as count FROM chunks');
    status.db.chunks = parseInt(chunkCount.rows[0].count, 10);

    const docCount = await pool.query('SELECT COUNT(*) as count FROM documents');
    status.db.documents = parseInt(docCount.rows[0].count, 10);

    const catResult = await pool.query(
      'SELECT content_category, COUNT(*) as count FROM chunks GROUP BY content_category ORDER BY count DESC'
    );
    status.db.categories = Object.fromEntries(
      catResult.rows.map((r: any) => [r.content_category, parseInt(r.count, 10)])
    );
    for (const row of catResult.rows) {
      chunksPerCategory.set(row.content_category, parseInt(row.count, 10));
    }

    const docCat = await pool.query(
      'SELECT content_category, COUNT(*) as count FROM documents GROUP BY content_category'
    );
    for (const row of docCat.rows) {
      documentsPerCategory.set(row.content_category, parseInt(row.count, 10));
    }

    const lastResult = await pool.query('SELECT MAX(created_at) as last FROM chunks');
    status.db.lastIngested = lastResult.rows[0].last ?? null;

    // Actual live dimension of the chunks.embedding column (the env value is
    // applied at runtime; this shows what the column really is right now).
    const dimRes = await pool.query(
      `SELECT atttypmod FROM pg_attribute
       WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`
    );
    status.db.vectorDimensions = dimRes.rows.length > 0
      ? (dimRes.rows[0].atttypmod === -1 ? null : dimRes.rows[0].atttypmod)
      : null;

    status.db.connected = true;
  } catch (err: any) {
    status.db.error = err.message;
  }

  const baseExists = await dirExists(INGEST_DATA_DIR);
  status.download.mounted = baseExists;

  for (const source of DOWNLOAD_SOURCES) {
    const files = baseExists ? await countTxtFiles(path.join(INGEST_DATA_DIR, source.dir)) : 0;
    status.download.sources.push({
      key: source.key,
      label: source.label,
      dir: source.dir,
      files: Math.max(files, 0),
      documents: documentsPerCategory.get(source.key) ?? 0,
      chunks: chunksPerCategory.get(source.key) ?? 0,
    });
  }

  const llmAuth = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  const embedAuth = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '';

  const [llmResult, embedResult] = await Promise.allSettled([
    (async () => {
      const start = Date.now();
      const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmAuth}` },
        body: JSON.stringify({ model: config.llmModel, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(10000),
      });
      return { connected: res.ok, pingTime: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      const res = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${embedAuth}` },
        body: JSON.stringify({ model: config.embeddingModel, input: 'test' }),
        signal: AbortSignal.timeout(10000),
      });
      return { connected: res.ok, pingTime: Date.now() - start };
    })(),
  ]);

  if (llmResult.status === 'fulfilled') {
    status.llm.connected = llmResult.value.connected;
    status.llm.pingTime = llmResult.value.pingTime;
  } else {
    status.llm.error = llmResult.reason?.message || 'LLM ping failed';
  }

  if (embedResult.status === 'fulfilled') {
    status.embedding.connected = embedResult.value.connected;
    status.embedding.pingTime = embedResult.value.pingTime;
  } else {
    status.embedding.error = embedResult.reason?.message || 'Embedding ping failed';
  }

  return NextResponse.json({
    ...status,
    config: {
      llmTimeout: config.llmTimeout,
      searchMinSimilarity: config.searchMinSimilarity,
      searchMaxChunks: config.searchMaxChunks,
    },
  });
}