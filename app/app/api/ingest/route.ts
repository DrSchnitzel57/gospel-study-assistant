import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getEmbedding } from '@/lib/llm';

export async function POST(req: NextRequest) {
  try {
    const { document, chunks } = await req.json();

    if (!document || !chunks || !Array.isArray(chunks)) {
      return NextResponse.json(
        { error: 'Document and chunks array required' },
        { status: 400 }
      );
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const docResult = await client.query(
        `INSERT INTO documents (title, author, date, source_type, official_status, doctrinal_weight, content_category, source_id, raw_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          document.title,
          document.author || null,
          document.date || null,
          document.source_type,
          document.official_status,
          document.doctrinal_weight,
          document.content_category,
          document.source_id || null,
          document.raw_url || null,
        ]
      );

      let docId = docResult.rows[0]?.id;

      if (!docId) {
        const existing = await client.query(
          'SELECT id FROM documents WHERE title = $1 AND content_category = $2',
          [document.title, document.content_category]
        );
        docId = existing.rows[0]?.id;

        if (!docId) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Could not find or create document' },
            { status: 500 }
          );
        }
      }

      for (const chunk of chunks) {
        const embedding = await getEmbedding(chunk.text);
        const embeddingStr = `[${embedding.join(',')}]`;

        await client.query(
          `INSERT INTO chunks (document_id, text, embedding, page_number, verse_reference, overlap_index)
           VALUES ($1, $2, $3::vector, $4, $5, $6)`,
          [docId, chunk.text, embeddingStr, chunk.page_number || null, chunk.verse_reference || null, chunk.overlap_index || 0]
        );
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        document_id: docId,
        chunks_indexed: chunks.length,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Ingest error:', error);
    return NextResponse.json(
      { error: 'Ingestion failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
