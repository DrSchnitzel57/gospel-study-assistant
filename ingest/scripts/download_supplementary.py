"""
Downloads BYU devotionals, Come Follow Me manuals, and Gospel Topics.
Uses Playwright for JS-rendered pages, falls back to requests for static content.
"""

import os
import re
import json
import time
import requests as http_requests
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).parent.parent / 'data'
REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}


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


def try_http_get(url: str, timeout: int = 30) -> str:
    """Try fetching a page with plain HTTP (works for static content)."""
    try:
        resp = http_requests.get(url, headers=REQUEST_HEADERS, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"    HTTP GET failed for {url}: {e}")
        return ''


def extract_page_text(page, min_length=200) -> str:
    """Extract main content text from a page."""
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


# ─── BYU Speeches ──────────────────────────────────────────────────────────────

def download_byu_speeches() -> int:
    """Download BYU devotionals/speeches from speeches.byu.edu."""
    print("\n=== Downloading BYU Speeches ===")

    all_devotionals = []
    saved = 0

    # Try HTTP first
    listing_html = try_http_get('https://speeches.byu.edu/')
    if not listing_html:
        print("  Could not fetch BYU speeches listing")
        return 0

    # Extract speech links
    speech_links = []
    for match in re.finditer(r'href=["\']([^"\']*)["\']', listing_html):
        href = match.group(1)
        if '/speech/' in href or '/devotional/' in href:
            if href.startswith('/'):
                href = 'https://speeches.byu.edu' + href
            elif href.startswith('http'):
                speech_links.append(href)
            else:
                speech_links.append('https://speeches.byu.edu/' + href)

    speech_links = list(dict.fromkeys(speech_links))[:50]
    print(f"  Found {len(speech_links)} speeches")

    for i, speech_url in enumerate(speech_links):
        try:
            speech_html = try_http_get(speech_url)
            if not speech_html:
                continue

            # Extract title
            title_match = re.search(r'<h1[^>]*>(.*?)</h1>', speech_html, re.DOTALL)
            title = 'BYU Speech'
            if title_match:
                title = clean_text(title_match.group(1))

            # Extract speaker
            speaker = 'Unknown'
            speaker_match = re.search(
                r'(?:speaker|author|presenter)[^>]*>([^<]+)',
                speech_html, re.IGNORECASE
            )
            if speaker_match:
                speaker = clean_text(speaker_match.group(1))

            # Extract date
            date_str = ''
            date_match = re.search(r'<time[^>]*datetime=["\']([^"\']*)["\']', speech_html)
            if date_match:
                date_str = date_match.group(1)

            # Extract content
            text = ''
            body_match = re.search(r'<body[^>]*>(.*?)</body>', speech_html, re.DOTALL)
            if body_match:
                body = body_match.group(1)
                for remove in ['<script[^>]*>.*?</script>', '<style[^>]*>.*?</style>',
                                '<nav[^>]*>.*?</nav>', '<footer[^>]*>.*?</footer>',
                                '<header[^>]*>.*?</header>']:
                    body = re.sub(remove, '', body, flags=re.DOTALL)
                text = clean_text(body)

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

        except Exception as e:
            print(f"    [{i+1}/{len(speech_links)}] ERROR: {e}")
            continue

        time.sleep(1)

    # Save index
    index_path = BASE_DIR / 'devotionals' / 'byu_index.json'
    index_path.write_text(json.dumps(all_devotionals, indent=2), encoding='utf-8')

    print(f"\n  BYU Speeches: {saved} downloaded")
    return saved


# ─── Come, Follow Me Manuals ───────────────────────────────────────────────────

def download_cfm_manuals() -> int:
    """Download Come, Follow Me manuals from churchofjesuschrist.org."""
    print("\n=== Downloading Come, Follow Me Manuals ===")

    all_lessons = []
    saved = 0

    years = ['2024', '2025']
    seasons = ['01', '04', '07', '10']
    audiences = ['individual-family']

    for year in years:
        for season in seasons:
            period = f'{year}/{season}'
            print(f"\n  Period: {period}")

            for audience in audiences:
                listing_url = f'https://www.churchofjesuschrist.org/study/come-follow-me/{audience}/{period}'

                # Try HTTP first (CFM pages are mostly static)
                html = try_http_get(listing_url)
                if not html:
                    print(f"    Could not fetch listing page, skipping period {period}")
                    continue

                # Extract lesson links from HTML
                lesson_links = []
                for match in re.finditer(r'href=["\']([^"\']*)["\']', html):
                    href = match.group(1)
                    if '/come-follow-me/' in href and len(href.split('/')) > 8:
                        if href.startswith('/'):
                            href = 'https://www.churchofjesuschrist.org' + href
                        lesson_links.append(href)

                lesson_links = list(dict.fromkeys(lesson_links))
                print(f"    Found {len(lesson_links)} lessons")

                for i, lesson_url in enumerate(lesson_links):
                    try:
                        lesson_html = try_http_get(lesson_url)
                        if not lesson_html:
                            continue

                        # Extract title
                        title_match = re.search(r'<h1[^>]*>(.*?)</h1>', lesson_html, re.DOTALL)
                        title = f'Lesson {i+1}'
                        if title_match:
                            title = clean_text(title_match.group(1))

                        # Extract main content - try article/main tags
                        text = ''
                        for tag in ['article', 'main', 'div[class*="content"]', 'div[class*="transcript"]']:
                            content_match = re.search(
                                r'<' + tag.replace('*', '[:alnum:]_-]+') + r'[^>]*>(.*?)</' +
                                tag.split('[')[0].split('>')[0] + r'>',
                                lesson_html, re.DOTALL
                            )
                            if content_match:
                                text = clean_text(content_match.group(1))
                                if len(text) > 200:
                                    break

                        # Fallback: strip all tags from body
                        if not text or len(text) < 200:
                            body_match = re.search(r'<body[^>]*>(.*?)</body>', lesson_html, re.DOTALL)
                            if body_match:
                                body = body_match.group(1)
                                for remove in ['<script[^>]*>.*?</script>', '<style[^>]*>.*?</style>',
                                                '<nav[^>]*>.*?</nav>', '<footer[^>]*>.*?</footer>',
                                                '<header[^>]*>.*?</header>']:
                                    body = re.sub(remove, '', body, flags=re.DOTALL)
                                text = clean_text(body)

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

                    except Exception:
                        continue

                    time.sleep(0.5)

    # Save index
    index_path = BASE_DIR / 'manuals' / 'cfm_index.json'
    index_path.write_text(json.dumps(all_lessons, indent=2), encoding='utf-8')

    print(f"\n  CFM Manuals: {saved} lessons downloaded")
    return saved


# ─── Gospel Topics Essays ──────────────────────────────────────────────────────

def download_gospel_topics() -> int:
    """Download Gospel Topics Essays from churchofjesuschrist.org."""
    print("\n=== Downloading Gospel Topics ===")

    all_essays = []
    saved = 0

    # Try HTTP first (Gospel Topics are static content)
    listing_html = try_http_get('https://www.churchofjesuschrist.org/study/topics')
    if not listing_html:
        print("  Could not fetch topics listing")
        return 0

    # Extract topic links
    topic_links = []
    for match in re.finditer(r'href=["\']([^"\']*)["\']', listing_html):
        href = match.group(1)
        if '/study/topics/' in href:
            if href.startswith('/'):
                href = 'https://www.churchofjesuschrist.org' + href
            topic_links.append(href)

    topic_links = list(dict.fromkeys(topic_links))
    print(f"  Found {len(topic_links)} topics")

    for i, topic_url in enumerate(topic_links):
        try:
            topic_html = try_http_get(topic_url)
            if not topic_html:
                continue

            title_match = re.search(r'<h1[^>]*>(.*?)</h1>', topic_html, re.DOTALL)
            title = f'Topic {i+1}'
            if title_match:
                title = clean_text(title_match.group(1))

            # Extract content
            text = ''
            body_match = re.search(r'<body[^>]*>(.*?)</body>', topic_html, re.DOTALL)
            if body_match:
                body = body_match.group(1)
                for remove in ['<script[^>]*>.*?</script>', '<style[^>]*>.*?</style>',
                                '<nav[^>]*>.*?</nav>', '<footer[^>]*>.*?</footer>',
                                '<header[^>]*>.*?</header>']:
                    body = re.sub(remove, '', body, flags=re.DOTALL)
                text = clean_text(body)

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

        except Exception:
            continue

        time.sleep(0.5)

    # Save index
    index_path = BASE_DIR / 'history' / 'topics_index.json'
    index_path.write_text(json.dumps(all_essays, indent=2), encoding='utf-8')

    print(f"\n  Gospel Topics: {saved} essays downloaded")
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
