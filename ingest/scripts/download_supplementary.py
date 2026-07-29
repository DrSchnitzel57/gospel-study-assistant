"""
Downloads BYU devotionals, Come Follow Me manuals, and Gospel Topics.
Uses Playwright for all JS-rendered pages.
"""

import os
import re
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).parent.parent / 'data'
BASE_URL = 'https://www.churchofjesuschrist.org'


def ensure_dirs():
    (BASE_DIR / 'manuals').mkdir(parents=True, exist_ok=True)
    (BASE_DIR / 'devotionals').mkdir(parents=True, exist_ok=True)
    (BASE_DIR / 'history').mkdir(parents=True, exist_ok=True)


def clean_text(html_content: str) -> str:
    """Strip HTML tags and clean up whitespace."""
    text = re.sub(r'<[^>]+>', ' ', html_content)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def extract_text_from_page(page, min_length=200) -> str:
    """Extract main content text from a page using Playwright."""
    try:
        page.wait_for_timeout(3000)

        # Try article/main content area first
        for selector in ['article', 'main', '[class*="content"]', '[class*="transcript"]', '[class*="body"]']:
            el = page.query_selector(selector)
            if el:
                # Strip nav/footer/sidebar within content
                for remove_sel in ['nav', 'footer', 'header', 'aside', '.nav', '.sidebar']:
                    for child in el.query_selector_all(remove_sel):
                        child.evaluate('el => el.innerHTML = ""')
                text = clean_text(el.inner_html())
                if len(text) > min_length:
                    return text

        # Fallback: body with nav/footer removed
        body = page.query_selector('body')
        if body:
            for selector in ['nav', 'footer', 'header', 'aside']:
                for el in body.query_selector_all(selector):
                    el.evaluate('el => el.innerHTML = ""')
            text = clean_text(body.inner_html())
            if len(text) > min_length:
                return text

    except Exception as e:
        print(f"    Error extracting text: {e}")

    return ''


# ─── Gospel Topics Essays ──────────────────────────────────────────────────────

def download_gospel_topics() -> int:
    """Download Gospel Topics Essays using Playwright."""
    print("\n=== Downloading Gospel Topics ===")

    all_essays = []
    saved = 0

    # Gospel Topics are at /study/gospel-topics/ (not /study/topics/)
    topics_url = f'{BASE_URL}/study/gospel-topics?lang=eng'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            viewport={'width': 1920, 'height': 1080},
        )
        page = context.new_page()

        try:
            print(f"  Fetching topics listing: {topics_url}")
            page.goto(topics_url, wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(5000)

            # Extract topic links from page
            topic_links = []
            for link_elem in page.query_selector_all('a[href]'):
                href = link_elem.get_attribute('href') or ''
                if '/gospel-topics/' in href and not href.startswith('#'):
                    if href.startswith('/'):
                        href = BASE_URL + href
                    if '?lang=' not in href:
                        href += '?lang=eng'
                    topic_links.append(href)

            # Deduplicate
            topic_links = list(dict.fromkeys(topic_links))
            print(f"  Found {len(topic_links)} topics")

            for i, topic_url in enumerate(topic_links):
                try:
                    page.goto(topic_url, wait_until='domcontentloaded', timeout=60000)
                    page.wait_for_timeout(3000)

                    # Extract title
                    h1 = page.query_selector('h1')
                    title = f'Topic {i+1}'
                    if h1:
                        title = h1.inner_text().strip()

                    # Extract content
                    text = extract_text_from_page(page)

                    if text and len(text) > 200:
                        safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                        safe_title = re.sub(r'\s+', '-', safe_title)
                        output_path = BASE_DIR / 'history' / f'Topic_{safe_title}.txt'

                        content = f"Title: {title}\n"
                        content += f"URL: {topic_url}\n\n"
                        content += text

                        output_path.write_text(content, encoding='utf-8')
                        all_essays.append({
                            'title': title,
                            'url': topic_url,
                            'file': str(output_path),
                        })
                        saved += 1
                        print(f"    [{i+1}/{len(topic_links)}] {title[:40]}... OK")
                    else:
                        print(f"    [{i+1}/{len(topic_links)}] {title[:40]}... SKIPPED (no text)")

                    time.sleep(1)

                except Exception as e:
                    print(f"    [{i+1}/{len(topic_links)}] ERROR: {e}")
                    continue

        except Exception as e:
            print(f"  Error fetching topics listing: {e}")

        browser.close()

    # Save index
    index_path = BASE_DIR / 'history' / 'topics_index.json'
    index_path.write_text(json.dumps(all_essays, indent=2), encoding='utf-8')

    print(f"\n  Gospel Topics: {saved} essays downloaded")
    return saved


# ─── Come, Follow Me Manuals ───────────────────────────────────────────────────

def download_cfm_manuals() -> int:
    """Download Come, Follow Me manuals using Playwright."""
    print("\n=== Downloading Come, Follow Me Manuals ===")

    all_lessons = []
    saved = 0

    years = ['2024', '2025']
    seasons = ['01', '04', '07', '10']
    audiences = ['individual-family']

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            viewport={'width': 1920, 'height': 1080},
        )
        page = context.new_page()

        for year in years:
            for season in seasons:
                period = f'{year}/{season}'
                print(f"\n  Period: {period}")

                for audience in audiences:
                    listing_url = f'{BASE_URL}/study/come-follow-me/{audience}/{period}?lang=eng'

                    try:
                        page.goto(listing_url, wait_until='domcontentloaded', timeout=60000)
                        page.wait_for_timeout(5000)

                        # Extract lesson links
                        lesson_links = []
                        for link_elem in page.query_selector_all('a[href]'):
                            href = link_elem.get_attribute('href') or ''
                            if '/come-follow-me/' in href:
                                # Skip the listing page itself
                                if f'/{period}' in href and '/week-' in href:
                                    if href.startswith('/'):
                                        href = BASE_URL + href
                                    if '?lang=' not in href:
                                        href += '?lang=eng'
                                    lesson_links.append(href)

                        lesson_links = list(dict.fromkeys(lesson_links))
                        print(f"    Found {len(lesson_links)} lessons")

                        for i, lesson_url in enumerate(lesson_links):
                            try:
                                page.goto(lesson_url, wait_until='domcontentloaded', timeout=60000)
                                page.wait_for_timeout(3000)

                                # Extract title
                                h1 = page.query_selector('h1')
                                title = f'Lesson {i+1}'
                                if h1:
                                    title = h1.inner_text().strip()

                                # Extract content
                                text = extract_text_from_page(page)

                                if text and len(text) > 200:
                                    safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                                    safe_title = re.sub(r'\s+', '-', safe_title)
                                    output_path = BASE_DIR / 'manuals' / f'CFM_{period}_{safe_title}.txt'

                                    content = f"Title: {title}\n"
                                    content += f"Period: {period}\n"
                                    content += f"URL: {lesson_url}\n\n"
                                    content += text

                                    output_path.write_text(content, encoding='utf-8')
                                    all_lessons.append({
                                        'title': title,
                                        'period': period,
                                        'url': lesson_url,
                                        'file': str(output_path),
                                    })
                                    saved += 1
                                    print(f"      [{i+1}/{len(lesson_links)}] {title[:40]}... OK")
                                else:
                                    print(f"      [{i+1}/{len(lesson_links)}] {title[:40]}... SKIPPED")

                                time.sleep(1)

                            except Exception as e:
                                print(f"      [{i+1}/{len(lesson_links)}] ERROR: {e}")
                                continue

                    except Exception as e:
                        print(f"    Error fetching listing: {e}")
                        continue

        browser.close()

    # Save index
    index_path = BASE_DIR / 'manuals' / 'cfm_index.json'
    index_path.write_text(json.dumps(all_lessons, indent=2), encoding='utf-8')

    print(f"\n  CFM Manuals: {saved} lessons downloaded")
    return saved


# ─── BYU Speeches ──────────────────────────────────────────────────────────────

def download_byu_speeches() -> int:
    """Download BYU devotionals/speeches using Playwright."""
    print("\n=== Downloading BYU Speeches ===")

    all_devotionals = []
    saved = 0

    # BYU Speeches uses a JS-rendered site - must use Playwright
    byu_base = 'https://speeches.byu.edu'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            viewport={'width': 1920, 'height': 1080},
        )
        page = context.new_page()

        try:
            # Try the speeches listing page
            page.goto(f'{byu_base}/speeches', wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(5000)

            # Extract speech links
            speech_links = []
            for link_elem in page.query_selector_all('a[href]'):
                href = link_elem.get_attribute('href') or ''
                if '/speeches/' in href or '/speech/' in href or '/devotional/' in href:
                    if href.startswith('/'):
                        href = byu_base + href
                    elif href.startswith('http'):
                        pass
                    else:
                        href = byu_base + '/' + href
                    speech_links.append(href)

            speech_links = list(dict.fromkeys(speech_links))[:50]
            print(f"  Found {len(speech_links)} speeches")

            for i, speech_url in enumerate(speech_links):
                try:
                    page.goto(speech_url, wait_until='domcontentloaded', timeout=60000)
                    page.wait_for_timeout(3000)

                    # Extract title
                    h1 = page.query_selector('h1')
                    title = 'BYU Speech'
                    if h1:
                        title = h1.inner_text().strip()

                    # Extract speaker
                    speaker = 'Unknown'
                    speaker_elem = page.query_selector(
                        '[class*="speaker"], [class*="author"], [class*="byline"], '
                        'meta[name="author"]'
                    )
                    if speaker_elem:
                        speaker = speaker_elem.inner_text().strip()

                    # Extract date
                    date_str = ''
                    time_elem = page.query_selector('time')
                    if time_elem:
                        date_str = time_elem.get_attribute('datetime') or time_elem.inner_text().strip()

                    # Extract content
                    text = extract_text_from_page(page)

                    if text and len(text) > 200:
                        safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                        safe_title = re.sub(r'\s+', '-', safe_title)
                        output_path = BASE_DIR / 'devotionals' / f'BYU_{safe_title}.txt'

                        content = f"Title: {title}\n"
                        content += f"Speaker: {speaker}\n"
                        content += f"Date: {date_str}\n"
                        content += f"URL: {speech_url}\n\n"
                        content += text

                        output_path.write_text(content, encoding='utf-8')
                        all_devotionals.append({
                            'title': title,
                            'speaker': speaker,
                            'date': date_str,
                            'url': speech_url,
                            'file': str(output_path),
                        })
                        saved += 1
                        print(f"    [{i+1}/{len(speech_links)}] {title[:40]}... OK")
                    else:
                        print(f"    [{i+1}/{len(speech_links)}] {title[:40]}... SKIPPED")

                    time.sleep(1)

                except Exception as e:
                    print(f"    [{i+1}/{len(speech_links)}] ERROR: {e}")
                    continue

        except Exception as e:
            print(f"  Error fetching BYU speeches: {e}")

        browser.close()

    # Save index
    index_path = BASE_DIR / 'devotionals' / 'byu_index.json'
    index_path.write_text(json.dumps(all_devotionals, indent=2), encoding='utf-8')

    print(f"\n  BYU Speeches: {saved} downloaded")
    return saved


# ─── Main Entry Point ──────────────────────────────────────────────────────────

def download_all():
    """Download all supplementary materials."""
    ensure_dirs()

    print("=" * 60)
    print("  Gospel Study Assistant — Supplementary Data Downloader")
    print("  (Playwright headless browser)")
    print("=" * 60)

    cfm_count = download_cfm_manuals()
    byu_count = download_byu_speeches()
    topics_count = download_gospel_topics()

    print(f"\n{'=' * 60}")
    print(f"  CFM Manuals:     {cfm_count}")
    print(f"  BYU Speeches:    {byu_count}")
    print(f"  Gospel Topics:   {topics_count}")
    print(f"  Files saved to:  {BASE_DIR}")
    print("=" * 60)


if __name__ == '__main__':
    download_all()
