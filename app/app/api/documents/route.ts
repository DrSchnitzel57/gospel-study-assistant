import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        content_category,
        source_type,
        official_status,
        doctrinal_weight,
        COUNT(*) as document_count,
        SUM(
          SELECT COUNT(*) FROM chunks WHERE chunks.document_id = documents.id
        ) as chunk_count
      FROM documents
      GROUP BY content_category, source_type, official_status, doctrinal_weight
      ORDER BY content_category
    `);

    const totalDocs = await pool.query('SELECT COUNT(*) FROM documents');
    const totalChunks = await pool.query('SELECT COUNT(*) FROM chunks');

    return NextResponse.json({
      breakdown: result.rows,
      total_documents: parseInt(totalDocs.rows[0].count),
      total_chunks: parseInt(totalChunks.rows[0].count),
    });
  } catch (error) {
    console.error('Documents stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch document stats' },
      { status: 500 }
    );
  }
}
