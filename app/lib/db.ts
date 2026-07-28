import { Pool } from 'pg';
import { registerTypes } from 'pgvector/pg';

let poolInstance: Pool | null = null;
let indexEnsured = false;

const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '4096', 10);

async function ensureVectorIndex(): Promise<void> {
  if (indexEnsured) return;
  const pool = getPool();
  try {
    const colRes = await pool.query(
      `SELECT atttypmod FROM pg_attribute
       WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`
    );
    if (colRes.rows.length > 0 && colRes.rows[0].atttypmod === -1) {
      console.log(`[DB] Altering embedding column to vector(${EMBEDDING_DIMENSIONS})...`);
      await pool.query(
        `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(${EMBEDDING_DIMENSIONS})`
      );
      console.log('[DB] Embedding column altered.');
    }

    const res = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_chunks_embedding'"
    );
    if (res.rows.length === 0) {
      console.log('[DB] Creating IVFFlat index on chunks.embedding...');
      await pool.query(
        'CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)'
      );
      console.log('[DB] IVFFlat index created.');
    }
  } catch (e) {
    console.error('[DB] Failed to ensure vector index:', e);
  }
  indexEnsured = true;
}

function getPool(): Pool {
  if (poolInstance) return poolInstance;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  poolInstance = new Pool({
    connectionString: databaseUrl,
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

// Ensure vector index on startup (non-blocking)
setImmediate(() => {
  pool.query('SELECT 1')
    .then(() => ensureVectorIndex())
    .catch(() => {
      // DB not ready yet, will retry on first search
    });
});

export default pool;
