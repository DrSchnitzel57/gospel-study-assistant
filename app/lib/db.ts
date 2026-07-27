import { Pool } from 'pg';
import { registerType } from 'pgvector/pg';

let poolInstance: Pool | null = null;
let indexEnsured = false;

async function ensureHnswIndex(): Promise<void> {
  if (indexEnsured) return;
  const pool = getPool();
  try {
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
    await registerType(client);
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

pool.query('SELECT 1').finally(() => {
  ensureHnswIndex();
}).catch(() => {});

export default pool;
