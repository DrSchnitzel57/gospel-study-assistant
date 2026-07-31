"""
Downloads BYU devotionals from speeches.byu.edu using WordPress REST API.
Covers speeches from 2000-2026.
Uses exponential backoff and retry logic.
"""
import os
import re
import json
import time
import logging
from pathlib import Path
import requests
from bs4 import BeautifulSoup

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent / 'data' / 'devotionals'
BYU_BASE = 'https://speeches.byu.edu'
API_BASE = f'{BYU_BASE}/wp-json/wp/v2/speech'

MAX_RETRIES = 3
BASE_DELAY = 0.5  # seconds between requests
REQUEST_TIMEOUT = 30  # 30 seconds

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}


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


def get_speeches_listing():
    """Get list of all BYU speeches from WordPress API."""
    speeches = []
    page = 1
    per_page = 100
    
    while True:
        url = f'{API_BASE}?per_page={per_page}&page={page}'
        logger.info(f"  Fetching speeches (page={page})...")
        
        try:
            resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            
            if not data:
                break
            
            speeches.extend(data)
            
            # Check if there are more pages
            total = int(resp.headers.get('X-WP-TotalPages', 1))
            if page >= total:
                break
            
            page += 1
            time.sleep(BASE_DELAY)
            
        except Exception as e:
            logger.error(f"  Error fetching speeches: {e}")
            break
    
    logger.info(f"  Found {len(speeches)} speeches total")
    return speeches


def extract_speech_text(html):
    """Extract text content from a rendered speech page."""
    soup = BeautifulSoup(html, 'html.parser')
    
    # Try to find main content area
    main = soup.find('main') or soup.find('article') or soup.find('div', class_='entry-content') or soup.find('body')
    if not main:
        return ''
    
    # Remove navigation, footer, header, scripts, styles
    for selector in ['nav', 'footer', 'header', 'aside', 'script', 'style', 'figure', 'button', 'img', 'svg']:
        elements = main.find_all(selector)
        for elem in elements:
            elem.decompose()
    
    text = main.get_text(separator='\n', strip=True)
    # Clean up whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def get_speaker_from_meta(speech_data):
    """Extract speaker name from speech metadata."""
    # Try to get from yoast_head_json
    yoast = speech_data.get('yoast_head_json', {})
    twitter_misc = yoast.get('twitter_misc', {})
    if 'Written by' in twitter_misc:
        return twitter_misc['Written by']
    
    # Try to get from class_list
    class_list = speech_data.get('class_list', [])
    for cls in class_list:
        if cls.startswith('speaker-'):
            speaker = cls.replace('speaker-', '').replace('-', ' ').title()
            if speaker and speaker != 'Unknown':
                return speaker
    
    return 'Unknown'


def download_byu_speeches():
    ensure_dir()
    logger.info("=" * 60)
    logger.info("  Downloading BYU Devotionals (WordPress API + BS4)")
    logger.info("=" * 60)
    
    all_speeches = []
    saved = 0
    
    # Get listing
    speeches = get_speeches_listing()
    
    # Filter to 2000-2026
    speeches = [s for s in speeches if s.get('date', '').startswith('20') and int(s.get('date', '0000')[:4]) >= 2000]
    logger.info(f"  Filtered to {len(speeches)} speeches (2000-2026)")
    
    session = requests.Session()
    session.headers.update(HEADERS)
    
    for i, speech in enumerate(speeches):
        speech_id = speech.get('id')
        if not speech_id:
            continue
        
        title = speech.get('title', {}).get('rendered', f'Speech {i + 1}')
        # Clean HTML from title
        title = re.sub(r'<[^>]+>', '', title).strip()
        
        link = speech.get('link', '')
        if not link:
            continue
        
        logger.info(f"\n  [{i + 1}/{len(speeches)}] {title[:50]}...")
        
        try:
            # Fetch full page for content
            resp = retry_with_backoff(session.get, link, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            
            text = extract_speech_text(resp.text)
            speaker = get_speaker_from_meta(speech)
            
            if len(text) > 200:
                safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                safe_title = re.sub(r'\s+', '-', safe_title)
                output_path = BASE_DIR / f'BYU_{safe_title}.txt'
                
                # Skip if already downloaded
                if output_path.exists() and output_path.stat().st_size > 200:
                    logger.info(f"    {title[:50]}... EXISTS")
                    saved += 1
                    all_speeches.append({
                        'title': title,
                        'speaker': speaker,
                        'url': link,
                        'file': str(output_path)
                    })
                    continue
                
                content = f"Title: {title}\nSpeaker: {speaker}\nURL: {link}\n\n{text}"
                output_path.write_text(content, encoding='utf-8')
                all_speeches.append({
                    'title': title,
                    'speaker': speaker,
                    'url': link,
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
    index_path = BASE_DIR / 'byu_index.json'
    index_path.write_text(json.dumps(all_speeches, indent=2), encoding='utf-8')
    
    logger.info(f"\n{'=' * 60}")
    logger.info(f"  Total speeches downloaded: {saved}")
    logger.info(f"  Files saved to: {BASE_DIR}")
    logger.info("=" * 60)
    return saved


if __name__ == '__main__':
    download_byu_speeches()
