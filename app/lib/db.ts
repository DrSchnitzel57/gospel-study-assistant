import { Pool } from 'pg';
import { registerTypes } from 'pgvector/pg';

let poolInstance: Pool | null = null;
let indexEnsured = false;

async function ensureHnswIndex(): Promise<void> {
  if (indexEnsured) return;
  const pool = getPool();
  try {
    // Check if embedding column has fixed dimensions
    const colRes = await pool.query(
      `SELECT atttypmod FROM pg_attribute
       WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`
    );
    if (colRes.rows.length > 0 && colRes.rows[0].atttypmod === -1) {
      console.log('[DB] Altering embedding column to vector(4096)...');
      await pool.query(
        "ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(4096)"
      );
      console.log('[DB] Embedding column altered.');
    }

    const res = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_chunks_embedding'"
    );
    if (res.rows.length === 0) {
      console.log('[DB] Creating HNSW index on chunks.embedding...');
      await pool.query(
        'CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)'
      );
      console.log('[DB] HNSW index created.');
    }
  } catch (e) {
    console.error('[DB] Failed to ensure HNSW index:', e);
  }
  indexEnsured = true;
}

function getPool(): Pool {
  if (poolInstance) return poolInstance;

  poolInstance = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://gospel:gospelpass@db:5432/gospel_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  poolInstance.on('connect', async (client) => {
    await registerTypes(client);
  });

  if (process.env.NODE_ENV !== 'production') {
    const globalAny = globalThis as any;
    if (!globalAny.__dbPool) {
      globalAny.__dbPool = poolInstance;
    } else {
      poolInstance = globalAny.__dbPool;
    }
  }

  return poolInstance!;
}

const pool = getPool();

// Ensure HNSW index on startup (non-blocking)
setImmediate(async () => {
  try {
    await pool.query('SELECT 1');
    await ensureHnswIndex();
  } catch {
    // DB not ready yet, will retry on first search
  }
});

export default pool;
