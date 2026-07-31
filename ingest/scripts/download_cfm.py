"""
Downloads Come, Follow Me manuals from Open Scripture API.
Covers 2026 lessons (52 weeks).
Uses exponential backoff and retry logic.
"""
import os
import re
import json
import time
import logging
from pathlib import Path
import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent / 'data' / 'manuals'
API_BASE = 'https://www.openscriptureapi.org/api/manuals/v1/lds/en/come-follow-me'

MAX_RETRIES = 3
BASE_DELAY = 1.0  # seconds between requests
REQUEST_TIMEOUT = 30  # 30 seconds


def ensure_dir():
    BASE_DIR.mkdir(parents=True, exist_ok=True)


def retry_with_backoff(func, *args, **kwargs):
    """Retry function with exponential backoff."""
    for attempt in range(MAX_RETRIES):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                delay = BASE_DELAY * (2 ** attempt)
                logger.warning(f"  Attempt {attempt + 1} failed: {e}. Retrying in {delay}s...")
                time.sleep(delay)
            else:
                logger.error(f"  All {MAX_RETRIES} attempts failed: {e}")
                raise


def get_lessons_listing():
    """Get list of all CFM lessons from API."""
    lessons = []
    offset = 0
    limit = 100
    
    while True:
        url = f'{API_BASE}?limit={limit}&offset={offset}'
        logger.info(f"  Fetching lessons (offset={offset})...")
        
        try:
            resp = requests.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            
            if 'lessons' not in data or not data['lessons']:
                break
            
            lessons.extend(data['lessons'])
            
            if len(data['lessons']) < limit:
                break
            
            offset += limit
            time.sleep(BASE_DELAY)
            
        except Exception as e:
            logger.error(f"  Error fetching lessons: {e}")
            break
    
    logger.info(f"  Found {len(lessons)} lessons total")
    return lessons


def get_lesson_detail(lesson_id):
    """Get full lesson detail from API."""
    url = f'{API_BASE}/{lesson_id}'
    return retry_with_backoff(
        lambda: requests.get(url, timeout=REQUEST_TIMEOUT)
    )


def download_cfm_manuals():
    ensure_dir()
    logger.info("=" * 60)
    logger.info("  Downloading Come, Follow Me Manuals (Open Scripture API)")
    logger.info("=" * 60)
    
    all_lessons = []
    saved = 0
    
    # Get listing
    lessons = get_lessons_listing()
    
    for i, lesson in enumerate(lessons):
        lesson_id = lesson.get('_id')
        if not lesson_id:
            continue
        
        logger.info(f"\n  [{i + 1}/{len(lessons)}] {lesson_id}...")
        
        try:
            # Get full lesson detail
            resp = get_lesson_detail(lesson_id)
            resp.raise_for_status()
            data = resp.json()
            
            title = data.get('title', f'Lesson {i + 1}')
            content_text = data.get('content', {}).get('text', '')
            manual_id = data.get('manualId', 'unknown')
            date_range = data.get('dateRange', {}).get('display', '')
            
            if len(content_text) > 200:
                safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                safe_title = re.sub(r'\s+', '-', safe_title)
                output_path = BASE_DIR / f'CFM_{manual_id}_{lesson_id}.txt'
                
                # Skip if already downloaded
                if output_path.exists() and output_path.stat().st_size > 200:
                    logger.info(f"    {title[:50]}... EXISTS")
                    saved += 1
                    all_lessons.append({
                        'title': title,
                        'manualId': manual_id,
                        'date': lesson_id,
                        'dateRange': date_range,
                        'file': str(output_path)
                    })
                    continue
                
                content = f"Title: {title}\nManual: {manual_id}\nDate: {date_range}\n\n{content_text}"
                output_path.write_text(content, encoding='utf-8')
                all_lessons.append({
                    'title': title,
                    'manualId': manual_id,
                    'date': lesson_id,
                    'dateRange': date_range,
                    'file': str(output_path)
                })
                saved += 1
                logger.info(f"    {title[:50]}... OK")
            else:
                logger.info(f"    {title[:40]}... SKIPPED (short)")
            
            time.sleep(BASE_DELAY)
            
        except Exception as e:
            logger.error(f"    ERROR: {e}")
            time.sleep(BASE_DELAY * 2)
    
    # Save index
    index_path = BASE_DIR / 'cfm_index.json'
    index_path.write_text(json.dumps(all_lessons, indent=2), encoding='utf-8')
    
    logger.info(f"\n{'=' * 60}")
    logger.info(f"  Total lessons downloaded: {saved}")
    logger.info(f"  Files saved to: {BASE_DIR}")
    logger.info("=" * 60)
    return saved


if __name__ == '__main__':
    download_cfm_manuals()
