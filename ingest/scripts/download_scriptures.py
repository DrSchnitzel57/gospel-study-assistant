"""
Downloads LDS scriptures from bcbooks/scriptures-json (open-source GitHub repo).
Saves plain text files to ingest/data/scriptures/{collection}/{book}.txt

Source: https://github.com/bcbooks/scriptures-json
All JSON files are hosted on raw.githubusercontent.com (no auth, no rate limits).
"""

import os
import json
import re
import requests
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent / 'data' / 'scriptures'

SCRIPTURE_URLS = {
    'old-testament': {
        'url': 'https://raw.githubusercontent.com/bcbooks/scriptures-json/master/old-testament.json',
        'target_dir': 'bible',
        'has_books': True,
    },
    'new-testament': {
        'url': 'https://raw.githubusercontent.com/bcbooks/scriptures-json/master/new-testament.json',
        'target_dir': 'bible',
        'has_books': True,
    },
    'book-of-mormon': {
        'url': 'https://raw.githubusercontent.com/bcbooks/scriptures-json/master/book-of-mormon.json',
        'target_dir': 'book-of-mormon',
        'has_books': True,
    },
    'doctrine-and-covenants': {
        'url': 'https://raw.githubusercontent.com/bcbooks/scriptures-json/master/doctrine-and-covenants.json',
        'target_dir': 'doctrine-and-covenants',
        'has_books': False,
    },
    'pearl-of-great-price': {
        'url': 'https://raw.githubusercontent.com/bcbooks/scriptures-json/master/pearl-of-great-price.json',
        'target_dir': 'pearl-of-great-price',
        'has_books': True,
    },
}


def ensure_dirs():
    for config in SCRIPTURE_URLS.values():
        (BASE_DIR / config['target_dir']).mkdir(parents=True, exist_ok=True)


def download_json(name: str, url: str) -> dict | None:
    """Download a scripture JSON file from GitHub raw."""
    print(f"  Downloading {name}... ({url})")
    try:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        print(f"    OK ({len(resp.text)} bytes)")
        return data
    except requests.RequestException as e:
        print(f"    FAILED: {e}")
        return None


def book_name_from_key(key: str) -> str:
    """Convert JSON book key to a display name (e.g., '1Nephi' -> '1 Nephi')."""
    name = key
    # Insert space between leading digits and letters
    name = re.sub(r'^(\d+)([A-Za-z])', r'\1 \2', name)
    return name


def format_book_text(books_data: list) -> dict:
    """
    Parse books-style JSON (OT, NT, BoM, PoGP).
    Structure: [ { book, chapters: [ { chapter, verses: [ { reference, text, verse } ] } ] } ]
    Returns: { book_name: "full text" }
    """
    result = {}

    for book in books_data:
        book_key = book.get('book', '')
        book_name = book_name_from_key(book_key)
        chapters = book.get('chapters', [])

        text_parts = []
        for chapter in chapters:
            chapter_num = chapter.get('chapter', '')
            verses = chapter.get('verses', [])

            for verse in verses:
                v_num = verse.get('verse', '')
                v_text = verse.get('text', '').strip().replace('\n', ' ')
                text_parts.append(f" {chapter_num}:{v_num} {v_text}")

        if text_parts:
            result[book_name] = ''.join(text_parts).strip()

    return result


def format_sections_text(sections_data: list) -> dict:
    """
    Parse sections-style JSON (D&C).
    Structure: [ { section, reference, verses: [ { reference, text, verse } ] } ]
    Returns: { section_name: "full text" }
    """
    result = {}

    for section in sections_data:
        section_num = section.get('section', '')
        section_name = f"Section {section_num}"
        verses = section.get('verses', [])

        text_parts = []
        for verse in verses:
            v_num = verse.get('verse', '')
            v_text = verse.get('text', '').strip().replace('\n', ' ')
            text_parts.append(f" {section_num}:{v_num} {v_text}")

        if text_parts:
            result[section_name] = ''.join(text_parts).strip()

    return result


def save_texts(texts: dict, target_dir: str):
    """Save text dict to .txt files."""
    saved = 0
    for book_name, text in texts.items():
        if not text or len(text) < 20:
            continue

        safe_name = re.sub(r'[^\w\s\-]', '', book_name)
        safe_name = re.sub(r'\s+', '-', safe_name)
        output_path = BASE_DIR / target_dir / f'{safe_name}.txt'

        if output_path.exists() and output_path.stat().st_size > 200:
            saved += 1
            continue

        output_path.write_text(text, encoding='utf-8')
        saved += 1

    return saved


def download_all_bible():
    """Download all scriptures from JSON repo."""
    ensure_dirs()

    print("=" * 60)
    print("  Gospel Study Assistant — Scripture Downloader")
    print("  Source: bcbooks/scriptures-json (GitHub)")
    print("=" * 60)

    total_saved = 0

    for name, config in SCRIPTURE_URLS.items():
        print(f"\n--- {name} ---")

        data = download_json(name, config['url'])
        if not data:
            print(f"  Skipping {name} (download failed)")
            continue

        target_dir = config['target_dir']

        if config['has_books']:
            books = data.get('books', [])
            texts = format_book_text(books)
        else:
            sections = data.get('sections', [])
            texts = format_sections_text(sections)

        saved = save_texts(texts, target_dir)
        total_saved += saved
        print(f"  Saved {saved}/{len(texts)} books to {target_dir}/")

    print(f"\n{'=' * 60}")
    print(f"  Total books saved: {total_saved}")
    print(f"  Files saved to: {BASE_DIR}")
    print(f"\n  Next step: Run ingestion pipeline:")
    print(f"    python -m scripts.run_ingest scripture")
    print("=" * 60)


if __name__ == '__main__':
    download_all_bible()
