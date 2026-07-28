import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getConfig } from '@/lib/llm';

export async function GET() {
  const status: {
    db: { connected: boolean; chunks: number; documents: number; categories: Record<string, number>; lastIngested: string | null; error?: string };
    llm: { connected: boolean; model: string; baseUrl: string; pingTime: number | null; error?: string };
    embedding: { connected: boolean; model: string; baseUrl: string; dimensions: number; pingTime: number | null; error?: string };
  } = {
    db: { connected: false, chunks: 0, documents: 0, categories: {}, lastIngested: null },
    llm: { connected: false, model: '', baseUrl: '', pingTime: null },
    embedding: { connected: false, model: '', baseUrl: '', dimensions: 0, pingTime: null },
  };

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

    const lastResult = await pool.query('SELECT MAX(created_at) as last FROM chunks');
    status.db.lastIngested = lastResult.rows[0].last;
    status.db.connected = true;
  } catch (err: any) {
    status.db.error = err.message;
  }

  const config = getConfig();
  status.llm.model = config.llmModel;
  status.llm.baseUrl = config.llmBaseUrl;
  status.embedding.model = config.embeddingModel;
  status.embedding.baseUrl = config.embeddingBaseUrl;
  status.embedding.dimensions = config.embeddingDimensions;

  try {
    const start = Date.now();
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ''}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });
    status.llm.connected = res.ok;
    status.llm.pingTime = Date.now() - start;
  } catch (err: any) {
    status.llm.error = err.message;
  }

  try {
    const start = Date.now();
    const res = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || ''}`,
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: 'test',
      }),
      signal: AbortSignal.timeout(10000),
    });
    status.embedding.connected = res.ok;
    status.embedding.pingTime = Date.now() - start;
  } catch (err: any) {
    status.embedding.error = err.message;
  }

  return NextResponse.json(status);
}
