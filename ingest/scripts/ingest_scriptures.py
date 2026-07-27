import os
import sys
import json
import re
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
    cur.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = 'documents_title_key'"
    )
    if not cur.fetchone():
        cur.execute(
            "ALTER TABLE documents ADD CONSTRAINT documents_title_key UNIQUE (title)"
        )


def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL)
    register_vector(conn)
    return conn


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split text into overlapping chunks by token count."""
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
    for i, (chunk_text_val, embedding) in enumerate(zip(chunks, embeddings)):
        embedding_str = '[' + ','.join(map(str, embedding)) + ']'
        cur.execute(
            """INSERT INTO chunks (document_id, text, embedding, verse_reference, overlap_index)
               VALUES (%s, %s, %s::vector, %s, %s)""",
            (doc_id, chunk_text_val, embedding_str, verse_ref, i)
        )


# ─── Scripture Ingestion ───────────────────────────────────────────────────────

SCRIPTURE_CONFIG = {
    'bible': {
        'name': 'The Holy Bible',
        'source_type': 'primary',
        'official_status': 'official',
        'doctrinal_weight': 'core',
        'content_category': 'scripture',
        'books': [
            'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
            'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
            '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job',
            'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah',
            'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel',
            'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
            'Haggai', 'Zechariah', 'Malachi',
            'Matthew', 'Mark', 'Luke', 'John', 'Acts',
            'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
            'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
            '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
            '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
        ],
    },
    'book-of-mormon': {
        'name': 'The Book of Mormon',
        'source_type': 'primary',
        'official_status': 'official',
        'doctrinal_weight': 'core',
        'content_category': 'scripture',
        'books': [
            '1 Nephi', '2 Nephi', 'Jacob', 'Enos', 'Jarom', 'Omni', 'Words of Mormon',
            'Mosiah', 'Alma', 'Helaman', '3 Nephi', '4 Nephi', 'Mormon', 'Ether', 'Moroni',
        ],
    },
    'doctrine-and-covenants': {
        'name': 'Doctrine and Covenants',
        'source_type': 'primary',
        'official_status': 'official',
        'doctrinal_weight': 'core',
        'content_category': 'scripture',
        'books': [f'Section {i}' for i in range(1, 115)],
    },
    'pearl-of-great-price': {
        'name': 'Pearl of Great Price',
        'source_type': 'primary',
        'official_status': 'official',
        'doctrinal_weight': 'core',
        'content_category': 'scripture',
        'books': [
            'The Book of Moses', 'The Book of Abraham',
            'Joseph Smith—Matthew', 'Joseph Smith—History', 'Articles of Faith',
        ],
    },
}


def get_or_create_source(cur, scripture_key: str, config: dict):
    """Get existing source or create it from config."""
    slug = scripture_key
    name = config['name']
    cur.execute('SELECT id FROM sources WHERE slug = %s', (slug,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        'INSERT INTO sources (slug, name, enabled_by_default, description) VALUES (%s, %s, %s, %s) ON CONFLICT (slug) DO NOTHING RETURNING id',
        (slug, name, True, name)
    )
    row = cur.fetchone()
    return row[0] if row else None


def ingest_scripture_from_text(scripture_key: str, book_name: str, text: str):
    """Ingest a single book/chapter of scripture from text with batch embeddings."""
    config = SCRIPTURE_CONFIG[scripture_key]

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Ensure schema is correct (handles stale pgdata volumes)
        ensure_schema(cur)
        conn.commit()

        # Get or create source_id
        source_id = get_or_create_source(cur, scripture_key, config)
        if not source_id:
            print(f"  Could not find/create source '{scripture_key}'. Skipping.")
            return 0
        conn.commit()

        # Insert or get document
        cur.execute(
            """INSERT INTO documents (title, author, source_type, official_status, doctrinal_weight, content_category, source_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (title) DO NOTHING
               RETURNING id""",
            (f"{config['name']}: {book_name}", 'Joseph Smith / Translated',
             config['source_type'], config['official_status'],
             config['doctrinal_weight'], config['content_category'], source_id)
        )

        doc_row = cur.fetchone()
        if not doc_row:
            cur.execute(
                'SELECT id FROM documents WHERE title = %s',
                (f"{config['name']}: {book_name}",)
            )
            doc_row = cur.fetchone()

        if not doc_row:
            print(f"  Could not create document for {book_name}")
            return 0

        doc_id = doc_row[0]

        # Chunk text
        chunks = chunk_text(text)
        verse_ref = book_name

        # Get embeddings in batches
        all_embeddings = get_embeddings(chunks, batch_size=EMBEDDING_BATCH_SIZE)

        # Insert all chunks with embeddings
        insert_chunks_batch(cur, doc_id, chunks, all_embeddings, verse_ref)

        conn.commit()
        print(f"  Indexed {len(chunks)} chunks for {book_name}")
        return len(chunks)

    except Exception as e:
        conn.rollback()
        print(f"  Error ingesting {book_name}: {e}")
        return 0
    finally:
        cur.close()
        conn.close()


def ingest_scriptures_from_directory(directory: str):
    """
    Ingest scriptures from a directory of text files.
    Expected format:
      scriptures/{scripture_key}/{book_name}.txt
    Each file contains the full text of that book/section.
    """
    import os
    import glob

    total_chunks = 0

    for scripture_key in SCRIPTURE_CONFIG:
        scripture_dir = os.path.join(directory, scripture_key)
        if not os.path.isdir(scripture_dir):
            print(f"Directory not found: {scripture_dir}")
            continue

        print(f"\nIngesting {SCRIPTURE_CONFIG[scripture_key]['name']}...")

        for filepath in sorted(glob.glob(os.path.join(scripture_dir, '*.txt'))):
            book_name = os.path.splitext(os.path.basename(filepath))[0]
            with open(filepath, 'r', encoding='utf-8') as f:
                text = f.read().strip()

            if len(text) < 50:
                print(f"  Skipping {book_name} (too short)")
                continue

            count = ingest_scripture_from_text(scripture_key, book_name, text)
            total_chunks += count

    print(f"\nTotal chunks indexed: {total_chunks}")
    return total_chunks


# ─── Main Entry Point ──────────────────────────────────────────────────────────

def run_scripture_ingestion():
    """Run scripture ingestion from data directory."""
    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'scriptures')

    if not os.path.isdir(data_dir):
        print(f"Scripture data directory not found: {data_dir}")
        print("Place scripture text files in: ingest/data/scriptures/{bible,book-of-mormon,doctrine-and-covenants,pearl-of-great-price}/")
        print("Each .txt file should be named {BookName}.txt and contain the full text of that book.")
        return

    ingest_scriptures_from_directory(data_dir)


if __name__ == '__main__':
    run_scripture_ingestion()
