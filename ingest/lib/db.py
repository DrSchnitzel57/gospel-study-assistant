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
            chunks.append((chunk_text_val.strip(), ""))
        start += chunk_size - overlap
    return chunks

import re

def chunk_scripture(text, max_tokens=300):
    """
    Chunks scripture text by verses. Format expected: ' 1:1 In the beginning... 1:2 And the earth...'
    Groups verses into chunks under max_tokens limit.
    Returns: list of (chunk_text, verse_reference)
    """
    pattern = re.compile(r'(?:\s+|^)(\d+:\d+)\s+')
    matches = list(pattern.finditer(text))
    
    if not matches:
        return chunk_text(text, max_tokens)
        
    verses = []
    for i, match in enumerate(matches):
        ref = match.group(1)
        start_idx = match.end()
        end_idx = matches[i+1].start() if i + 1 < len(matches) else len(text)
        verse_text = text[start_idx:end_idx].strip()
        verses.append((ref, verse_text))
        
    chunks = []
    current_chunk = []
    current_tokens = 0
    current_refs = []
    
    for ref, v_text in verses:
        tokens = len(enc.encode(v_text))
        if current_tokens + tokens > max_tokens and current_chunk:
            # Join current chunk
            chunk_str = " ".join(current_chunk)
            ref_str = f"{current_refs[0]}-{current_refs[-1]}" if len(current_refs) > 1 else current_refs[0]
            chunks.append((chunk_str, ref_str))
            current_chunk = []
            current_tokens = 0
            current_refs = []
            
        current_chunk.append(f"{ref} {v_text}")
        current_refs.append(ref)
        current_tokens += tokens
        
    if current_chunk:
        chunk_str = " ".join(current_chunk)
        ref_str = f"{current_refs[0]}-{current_refs[-1]}" if len(current_refs) > 1 else current_refs[0]
        chunks.append((chunk_str, ref_str))
        
    return chunks

def chunk_text_semantic(text, max_tokens=400):
    """
    Chunks standard text by paragraphs (separated by double newlines).
    Returns: list of (chunk_text, "")
    """
    paragraphs = re.split(r'\n{2,}', text)
    chunks = []
    current_chunk = []
    current_tokens = 0
    
    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        tokens = len(enc.encode(p))
        if current_tokens + tokens > max_tokens and current_chunk:
            chunks.append(("\n\n".join(current_chunk), ""))
            current_chunk = []
            current_tokens = 0
            
        # If a single paragraph is larger than max_tokens, we still add it
        # (could be refined to sub-split by sentences, but this works for now)
        current_chunk.append(p)
        current_tokens += tokens
        
    if current_chunk:
        chunks.append(("\n\n".join(current_chunk), ""))
        
    return chunks


def insert_chunks_batch(cur, doc_id, chunks_data, embeddings, base_verse_ref):
    for i, ((chunk_val, verse_ref), embedding) in enumerate(zip(chunks_data, embeddings)):
        embedding_str = '[' + ','.join(map(str, embedding)) + ']'
        
        # Format the final reference
        if base_verse_ref and verse_ref:
            final_ref = f"{base_verse_ref} {verse_ref}"
        elif base_verse_ref:
            final_ref = base_verse_ref
        elif verse_ref:
            final_ref = verse_ref
        else:
            final_ref = ""
            
        cur.execute(
            """INSERT INTO chunks (document_id, text, embedding, verse_reference, overlap_index)
               VALUES (%s, %s, %s::vector, %s, %s)""",
            (doc_id, chunk_val, embedding_str, final_ref, i)
        )
