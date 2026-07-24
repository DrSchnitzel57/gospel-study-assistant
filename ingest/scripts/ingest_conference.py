import os
import sys
import json
import re
import requests
import psycopg2
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from llm import get_embedding

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://gospel:gospelpass@db:5432/gospel_db')

# Conference talk config
CONFERENCE_CONFIG = {
    'source_type': 'primary',
    'official_status': 'official',
    'doctrinal_weight': 'supporting',
    'content_category': 'conference',
}


def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL)
    register_vector(conn)
    return conn


def chunk_text(text, chunk_size=500, overlap=50):
    import tiktoken
    enc = tiktoken.get_encoding("cl100k_base")
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


def clean_html(html):
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def fetch_conference_talks():
    """
    Fetch General Conference talks from the Church API.
    Adjust this based on the actual API endpoint.
    """
    # The Church's official API for conference talks
    # This is a placeholder — update with the actual API endpoint
    api_url = 'https://api.churchofjesuschrist.org/stats/v1/'

    # For now, we'll scrape from lds.org
    # This is a simplified version — you'll want to expand this
    print("Conference talk ingestion: Placeholder — implement with actual API or scraping.")
    print("See: https://www.churchofjesuschrist.org/study/general-conference")
    return []


def ingest_conference_talk(talk_data: dict):
    """Ingest a single conference talk."""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        cur.execute('SELECT id FROM sources WHERE slug = %s', ('general-conference',))
        source_row = cur.fetchone()
        if not source_row:
            print("  Source 'general-conference' not found. Skipping.")
            return 0

        source_id = source_row[0]
        title = talk_data.get('title', 'Untitled Talk')
        speaker = talk_data.get('speaker', 'Unknown')
        date = talk_data.get('date')
        text = talk_data.get('text', '')

        if not text or len(text) < 100:
            print(f"  Skipping {title} (insufficient text)")
            return 0

        # Insert document
        cur.execute(
            """INSERT INTO documents (title, author, date, source_type, official_status, doctrinal_weight, content_category, source_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT DO NOTHING
               RETURNING id""",
            (title, speaker, date,
             CONFERENCE_CONFIG['source_type'], CONFERENCE_CONFIG['official_status'],
             CONFERENCE_CONFIG['doctrinal_weight'], CONFERENCE_CONFIG['content_category'], source_id)
        )

        doc_row = cur.fetchone()
        if not doc_row:
            cur.execute('SELECT id FROM documents WHERE title = %s', (title,))
            doc_row = cur.fetchone()

        if not doc_row:
            print(f"  Could not create document for {title}")
            return 0

        doc_id = doc_row[0]

        # Chunk and embed
        chunks = chunk_text(text)
        total = 0

        for i, chunk_text_val in enumerate(chunks):
            embedding = get_embedding(chunk_text_val)
            embedding_str = '[' + ','.join(map(str, embedding)) + ']'

            cur.execute(
                """INSERT INTO chunks (document_id, text, embedding, verse_reference, overlap_index)
                   VALUES (%s, %s, %s::vector, %s, %s)""",
                (doc_id, chunk_text_val, embedding_str, f"{speaker} — {date or 'Conference'}", i)
            )
            total += 1

        conn.commit()
        print(f"  Indexed {total} chunks for {title}")
        return total

    except Exception as e:
        conn.rollback()
        print(f"  Error ingesting {talk_data.get('title', 'Unknown')}: {e}")
        return 0
    finally:
        cur.close()
        conn.close()


def run_conference_ingestion():
    """Run conference talk ingestion."""
    print("\n=== General Conference Talks Ingestion ===")
    talks = fetch_conference_talks()

    if not talks:
        print("No talks found. Implement fetch_conference_talks() with actual data source.")
        return

    total = 0
    for talk in talks:
        count = ingest_conference_talk(talk)
        total += count

    print(f"\nTotal conference chunks indexed: {total}")


if __name__ == '__main__':
    run_conference_ingestion()
