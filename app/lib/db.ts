import { Pool } from 'pg';
import { registerType } from 'pgvector/pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://gospel:gospelpass@db:5432/gospel_db',
});

pool.on('connect', async (client) => {
  await registerType(client);
});

export default pool;
