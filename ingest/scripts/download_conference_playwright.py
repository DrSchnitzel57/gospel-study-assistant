"""
Downloads General Conference talks from churchofjesuschrist.org using Playwright.
Handles JavaScript-rendered content and exponential backoff/retry logic.
Covers conferences from 2000/04 to 2026/04 (forward chronologically).
"""
import os
import re
import json
import time
import logging
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PwTimeoutError

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent / 'data' / 'conference'
CONFERENCE_URL = 'https://www.churchofjesuschrist.org/study/general-conference'

MAX_RETRIES = 3
BASE_DELAY = 2.0  # seconds between requests
REQUEST_TIMEOUT = 60000  # 60 seconds


def ensure_dir():
    BASE_DIR.mkdir(parents=True, exist_ok=True)


def generate_conferences():
    """Generate conference slugs from 2000/04 to 2026/04 (forward chronologically)."""
    conferences = []
    for year in range(2000, 2027):
        if year < 2026:
            conferences.append(f'{year}/04')
            conferences.append(f'{year}/10')
        else:
            # 2026 only has April conference so far
            conferences.append(f'{year}/04')
    return conferences


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


def extract_talk_text(page):
    """Extract text content from a rendered talk page."""
    try:
        # Wait for content to load
        page.wait_for_selector('main, article, body', timeout=REQUEST_TIMEOUT)
        time.sleep(1)  # Additional wait for JS rendering
        
        # Get text from main content area
        main = page.query_selector('main') or page.query_selector('article') or page.query_selector('body')
        if not main:
            return ''
        
        # Remove navigation, footer, header, scripts, styles
        for selector in ['nav', 'footer', 'header', 'aside', 'script', 'style', 'figure', 'button', 'img', 'svg']:
            elements = main.query_selector_all(selector)
            for elem in elements:
                elem.evaluate('el => el.remove()')
        
        text = main.inner_text() or ''
        # Clean up whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()
    except Exception as e:
        logger.error(f"  Error extracting text: {e}")
        return ''


def get_talk_title(page):
    """Get talk title from page."""
    try:
        h1 = page.query_selector('h1')
        if h1:
            return h1.inner_text().strip()
        # Fallback to page title
        title = page.title()
        if title:
            return title.split('|')[0].strip()
    except Exception as e:
        logger.error(f"  Error getting title: {e}")
    return 'Unknown Talk'


def get_talk_speaker(page):
    """Get speaker name from page."""
    try:
        # Try common speaker element selectors
        for selector in ['p[class*="author"]', '#author1', '[class*="speaker"]']:
            elem = page.query_selector(selector)
            if elem:
                speaker = elem.inner_text().strip()
                if speaker:
                    return speaker
    except Exception as e:
        logger.error(f"  Error getting speaker: {e}")
    return 'Unknown'


def download_conference_talks():
    ensure_dir()
    logger.info("=" * 60)
    logger.info("  Downloading General Conference Talks (Playwright)")
    logger.info("=" * 60)
    
    all_talks = []
    talk_files_saved = 0
    conferences = generate_conferences()
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport={'width': 1280, 'height': 720}
        )
        page = context.new_page()
        
        for conf_idx, conf_slug in enumerate(conferences):
            conf_url = f'{CONFERENCE_URL}/{conf_slug}?lang=eng'
            logger.info(f"\n  [{conf_idx + 1}/{len(conferences)}] Conference {conf_slug}...")
            
            try:
                # Navigate to conference listing page
                retry_with_backoff(page.goto, conf_url, wait_until='domcontentloaded', timeout=REQUEST_TIMEOUT)
                time.sleep(1)  # Wait for JS to render
                
                # Extract talk links
                talk_links = []
                links = page.query_selector_all('a[href*="/general-conference/"]')
                for link in links:
                    href = link.get_attribute('href')
                    if href and f'/general-conference/{conf_slug}/' in href:
                        # Filter out session links (they have shorter paths)
                        if len(href.split('/')) > 5:
                            if href.startswith('/'):
                                href = 'https://www.churchofjesuschrist.org' + href
                            if '?lang=' not in href:
                                href += '?lang=eng'
                            talk_links.append(href)
                
                # Deduplicate
                talk_links = list(dict.fromkeys(talk_links))
                logger.info(f"    Found {len(talk_links)} talks")
                
                for talk_idx, talk_url in enumerate(talk_links):
                    try:
                        # Navigate to talk page
                        retry_with_backoff(page.goto, talk_url, wait_until='domcontentloaded', timeout=REQUEST_TIMEOUT)
                        
                        # Extract content
                        title = get_talk_title(page)
                        speaker = get_talk_speaker(page)
                        text = extract_talk_text(page)
                        
                        if len(text) > 200:
                            safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                            safe_title = re.sub(r'\s+', '-', safe_title)
                            output_path = BASE_DIR / f'{conf_slug.replace("/", "_")}_{safe_title}.txt'
                            
                            # Skip if already downloaded
                            if output_path.exists() and output_path.stat().st_size > 200:
                                logger.info(f"    [{talk_idx + 1}/{len(talk_links)}] {title[:50]}... EXISTS")
                                talk_files_saved += 1
                                all_talks.append({'title': title, 'speaker': speaker, 'url': talk_url, 'file': str(output_path)})
                                continue
                            
                            content = f"Title: {title}\nSpeaker: {speaker}\nURL: {talk_url}\n\n{text}"
                            output_path.write_text(content, encoding='utf-8')
                            all_talks.append({'title': title, 'speaker': speaker, 'url': talk_url, 'file': str(output_path)})
                            talk_files_saved += 1
                            logger.info(f"    [{talk_idx + 1}/{len(talk_links)}] {title[:50]}... OK")
                        else:
                            logger.info(f"    [{talk_idx + 1}/{len(talk_links)}] {title[:40]}... SKIPPED (short)")
                        
                        time.sleep(BASE_DELAY)  # Rate limiting
                        
                    except Exception as e:
                        logger.error(f"    [{talk_idx + 1}/{len(talk_links)}] ERROR: {e}")
                        time.sleep(BASE_DELAY * 2)  # Longer delay on error
                        
            except Exception as e:
                logger.error(f"    Error fetching conference listing: {e}")
                time.sleep(BASE_DELAY * 2)
            
            # Save progress periodically
            if (conf_idx + 1) % 5 == 0:
                index_path = BASE_DIR / 'talks_index.json'
                index_path.write_text(json.dumps(all_talks, indent=2), encoding='utf-8')
                logger.info(f"  Progress saved: {talk_files_saved} talks so far")
        
        browser.close()
    
    # Save final index
    index_path = BASE_DIR / 'talks_index.json'
    index_path.write_text(json.dumps(all_talks, indent=2), encoding='utf-8')
    
    logger.info(f"\n{'=' * 60}")
    logger.info(f"  Total talks downloaded: {talk_files_saved}")
    logger.info(f"  Files saved to: {BASE_DIR}")
    logger.info("=" * 60)
    return talk_files_saved


if __name__ == '__main__':
    download_conference_talks()
