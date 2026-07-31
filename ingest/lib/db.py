import os
import psycopg2
from psycopg2 import pool as pg_pool
from pgvector.psycopg2 import register_vector
import tiktoken
import logging

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    raise ValueError('DATABASE_URL environment variable is required')

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
EMBEDDING_BATCH_SIZE = 64

enc = tiktoken.get_encoding("cl100k_base")

_connection_pool = None


def get_pool():
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = pg_pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=DATABASE_URL,
        )
    return _connection_pool


def get_conn():
    pool = get_pool()
    conn = pool.getconn()
    register_vector(conn)
    return conn


def return_conn(conn):
    pool = get_pool()
    pool.putconn(conn)


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    tokens = enc.encode(text)
    chunks = []
    start = 0
    while start < len(tokens):
        end = min(start + chunk_size, len(tokens))
        chunk_tokens = tokens[start:end]
        chunk_text_val = enc.decode(chunk_tokens)
        if chunk_text_val.strip():
            chunks.append(chunk_text_val.strip())
        start += chunk_size - overlap
    return chunks


def insert_chunks_batch(cur, doc_id, chunks, embeddings, verse_ref):
    for i, (chunk_val, embedding) in enumerate(zip(chunks, embeddings)):
        embedding_str = '[' + ','.join(map(str, embedding)) + ']'
        cur.execute(
            """INSERT INTO chunks (document_id, text, embedding, verse_reference, overlap_index)
               VALUES (%s, %s, %s::vector, %s, %s)""",
            (doc_id, chunk_val, embedding_str, verse_ref, i)
        )
