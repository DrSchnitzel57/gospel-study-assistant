"""
Ingests Conference talks, CFM manuals, BYU devotionals, and Gospel Topics.
Reads text files from ingest/data/ and chunks + embeds them into PostgreSQL.
"""

import os
import re
import json
import glob
import sys
import psycopg2
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector
import tiktoken

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from llm import get_embeddings

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://gospel:gospelpass@db:5432/gospel_db')
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
EMBEDDING_BATCH_SIZE = 64

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

enc = tiktoken.get_encoding("cl100k_base")


def ensure_schema(cur):
    """Ensure required constraints exist (handles stale pgdata volumes)."""
    cur.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = 'sources_slug_key'"
    )
    if not cur.fetchone():
        cur.execute(
            "ALTER TABLE sources ADD CONSTRAINT sources_slug_key UNIQUE (slug)"
        )


def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL)
    register_vector(conn)
    return conn


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    tokens = enc.encode(text)
    chunks = []
    start = 0
    while start < len(tokens):
        end = min(start + chunk_size, len(tokens))
        chunk_tokens = tokens[start:end]
        chunk_text = enc.decode(chunk_tokens)
        if chunk_text.strip():
            chunks.append(chunk_text.strip())
        start += chunk_size - overlap
    return chunks


def insert_chunks_batch(cur, doc_id, chunks, embeddings, verse_ref):
    """Insert chunks with their embeddings in a single batch."""
    for i, (chunk_val, embedding) in enumerate(zip(chunks, embeddings)):
        embedding_str = '[' + ','.join(map(str, embedding)) + ']'
        cur.execute(
            """INSERT INTO chunks (document_id, text, embedding, verse_reference, overlap_index)
               VALUES (%s, %s, %s::vector, %s, %s)""",
            (doc_id, chunk_val, embedding_str, verse_ref, i)
        )


def get_or_create_source(slug: str, name: str, conn):
    cur = conn.cursor()
    ensure_schema(cur)
    cur.execute('SELECT id FROM sources WHERE slug = %s', (slug,))
    row = cur.fetchone()
    if row:
        cur.close()
        return row[0]

    cur.execute(
        'INSERT INTO sources (slug, name, enabled_by_default, description) VALUES (%s, %s, %s, %s) ON CONFLICT (slug) DO NOTHING RETURNING id',
        (slug, name, True, name)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    return row[0] if row else None


def ingest_text_file(
    filepath: str,
    title: str,
    author: str,
    date: str,
    source_type: str,
    official_status: str,
    doctrinal_weight: str,
    content_category: str,
    source_slug: str,
    reference_prefix: str = '',
):
    """Ingest a single text file into the database with batch embeddings."""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        source_id = get_or_create_source(source_slug, title, conn)
        if not source_id:
            print(f"    Could not find/create source '{source_slug}'")
            return 0

        # Insert or find document
        cur.execute(
            """INSERT INTO documents (title, author, date, source_type, official_status, doctrinal_weight, content_category, source_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (title) DO NOTHING
               RETURNING id""",
            (title, author, date or None, source_type, official_status,
             doctrinal_weight, content_category, source_id)
        )

        doc_row = cur.fetchone()
        if not doc_row:
            cur.execute('SELECT id FROM documents WHERE title = %s', (title,))
            doc_row = cur.fetchone()

        if not doc_row:
            print(f"    Could not create document: {title}")
            return 0

        doc_id = doc_row[0]

        # Read and chunk text
        with open(filepath, 'r', encoding='utf-8') as f:
            text = f.read()

        # Strip metadata lines (Title:, Speaker:, Date:, URL:)
        text_lines = text.split('\n')
        content_start = 0
        for i, line in enumerate(text_lines):
            if line.strip() and not any(line.startswith(p) for p in ['Title:', 'Speaker:', 'Date:', 'URL:']):
                content_start = i
                break
        text = '\n'.join(text_lines[content_start:]).strip()

        if len(text) < 50:
            print(f"    Skipping (too short): {title}")
            return 0

        chunks = chunk_text(text)

        # Get embeddings in batches
        all_embeddings = get_embeddings(chunks, batch_size=EMBEDDING_BATCH_SIZE)

        # Insert all chunks
        insert_chunks_batch(cur, doc_id, chunks, all_embeddings, reference_prefix or title)

        conn.commit()
        print(f"    Indexed {len(chunks)} chunks for {title[:60]}")
        return len(chunks)

    except Exception as e:
        conn.rollback()
        print(f"    Error ingesting {title}: {e}")
        return 0
    finally:
        cur.close()
        conn.close()


# ─── Conference Talks ──────────────────────────────────────────────────────────

def ingest_conference_talks():
    """Ingest conference talk text files."""
    print("\n=== Ingesting Conference Talks ===")

    conference_dir = os.path.join(DATA_DIR, 'conference')
    if not os.path.isdir(conference_dir):
        print("  Conference directory not found. Run download_conference.py first.")
        return 0

    files = glob.glob(os.path.join(conference_dir, '*.txt'))
    total = 0

    for filepath in sorted(files):
        filename = os.path.basename(filepath)

        # Parse metadata from file
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        title = 'Conference Talk'
        speaker = 'Unknown'
        date = ''
        content_lines = []

        for line in lines:
            if line.startswith('Title: '):
                title = line[7:].strip()
            elif line.startswith('Speaker: '):
                speaker = line[9:].strip()
            elif line.startswith('Date: '):
                date = line[6:].strip()
            elif line.startswith('URL: '):
                pass  # Skip
            elif line.strip():
                content_lines.append(line)

        if content_lines:
            count = ingest_text_file(
                filepath=filepath,
                title=title,
                author=speaker,
                date=date,
                source_type='primary',
                official_status='official',
                doctrinal_weight='supporting',
                content_category='conference',
                source_slug='general-conference',
                reference_prefix=f'{speaker} — {date}',
            )
            total += count

    print(f"  Conference talks: {total} chunks indexed")
    return total


# ─── Come, Follow Me Manuals ───────────────────────────────────────────────────

def ingest_cfm_manuals():
    """Ingest CFM manual text files."""
    print("\n=== Ingesting Come, Follow Me Manuals ===")

    manuals_dir = os.path.join(DATA_DIR, 'manuals')
    if not os.path.isdir(manuals_dir):
        print("  Manuals directory not found. Run download_supplementary.py first.")
        return 0

    files = glob.glob(os.path.join(manuals_dir, 'CFM_*.txt'))
    total = 0

    for filepath in sorted(files):
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        title = 'CFM Manual'
        period = ''

        for line in lines:
            if line.startswith('Title: '):
                title = line[7:].strip()
            elif line.startswith('Period: '):
                period = line[8:].strip()

        count = ingest_text_file(
            filepath=filepath,
            title=title,
            author='Church Educational System',
            date=None,
            source_type='secondary',
            official_status='official',
            doctrinal_weight='supporting',
            content_category='manual',
            source_slug='come-follow-me',
            reference_prefix=f'CFM — {period}',
        )
        total += count

    print(f"  CFM Manuals: {total} chunks indexed")
    return total


# ─── BYU Devotionals ───────────────────────────────────────────────────────────

def ingest_byu_devotionals():
    """Ingest BYU devotional text files."""
    print("\n=== Ingesting BYU Devotionals ===")

    devotional_dir = os.path.join(DATA_DIR, 'devotionals')
    if not os.path.isdir(devotional_dir):
        print("  Devotionals directory not found. Run download_supplementary.py first.")
        return 0

    files = glob.glob(os.path.join(devotional_dir, 'BYU_*.txt'))
    total = 0

    for filepath in sorted(files):
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        title = 'BYU Devotional'
        speaker = 'Unknown'
        date = ''

        for line in lines:
            if line.startswith('Title: '):
                title = line[7:].strip()
            elif line.startswith('Speaker: '):
                speaker = line[9:].strip()
            elif line.startswith('Date: '):
                date = line[6:].strip()

        count = ingest_text_file(
            filepath=filepath,
            title=title,
            author=speaker,
            date=date,
            source_type='primary',
            official_status='unofficial',
            doctrinal_weight='supporting',
            content_category='devotional',
            source_slug='byu-devotionals',
            reference_prefix=f'{speaker} — {date}',
        )
        total += count

    print(f"  BYU Devotionals: {total} chunks indexed")
    return total


# ─── Gospel Topics ─────────────────────────────────────────────────────────────

def ingest_gospel_topics():
    """Ingest Gospel Topics essays."""
    print("\n=== Ingesting Gospel Topics ===")

    history_dir = os.path.join(DATA_DIR, 'history')
    if not os.path.isdir(history_dir):
        print("  History directory not found. Run download_supplementary.py first.")
        return 0

    files = glob.glob(os.path.join(history_dir, 'Topic_*.txt'))
    total = 0

    for filepath in sorted(files):
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        title = 'Gospel Topic'

        for line in lines:
            if line.startswith('Title: '):
                title = line[7:].strip()

        count = ingest_text_file(
            filepath=filepath,
            title=title,
            author='The Church of Jesus Christ of Latter-day Saints',
            date=None,
            source_type='secondary',
            official_status='official',
            doctrinal_weight='supporting',
            content_category='history',
            source_slug='church-history',
            reference_prefix=title,
        )
        total += count

    print(f"  Gospel Topics: {total} chunks indexed")
    return total


# ─── Main Entry Point ──────────────────────────────────────────────────────────

def run_supplementary_ingestion():
    """Run all supplementary ingestion pipelines."""
    print("=" * 60)
    print("  Gospel Study Assistant — Supplementary Ingestion")
    print("=" * 60)

    total = 0
    total += ingest_conference_talks()
    total += ingest_cfm_manuals()
    total += ingest_byu_devotionals()
    total += ingest_gospel_topics()

    print(f"\n{'=' * 60}")
    print(f"  Total chunks indexed: {total}")
    print("=" * 60)


if __name__ == '__main__':
    run_supplementary_ingestion()
