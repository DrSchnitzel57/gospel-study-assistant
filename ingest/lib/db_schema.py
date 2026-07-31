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
    if row:
        current_dims = row[0]
        if current_dims == -1 or current_dims != embedding_dims:
            logger.info(f"Altering embedding column from vector({current_dims if current_dims != -1 else 'any'}) to vector({embedding_dims})...")
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
