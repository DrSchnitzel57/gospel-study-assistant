import { Pool } from 'pg';
import { registerType } from 'pgvector/pg';

let poolInstance: Pool | null = null;

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

export default getPool();
