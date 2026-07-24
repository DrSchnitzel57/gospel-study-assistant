"""
Downloads General Conference talks from churchofjesuschrist.org using Playwright.
Bypasses Cloudflare and handles client-side rendering.
"""

import os
import re
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).parent.parent / 'data' / 'conference'
CONFERENCE_URL = 'https://www.churchofjesuschrist.org/study/general-conference'


def ensure_dir():
    BASE_DIR.mkdir(parents=True, exist_ok=True)


def clean_text(html_content: str) -> str:
    """Strip HTML tags and clean up whitespace."""
    text = re.sub(r'<[^>]+>', ' ', html_content)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def extract_talk_text(page) -> str:
    """Extract the main transcript text from a conference talk page."""
    try:
        # Wait for content to load
        page.wait_for_timeout(3000)

        # Try to find the main article content
        article = page.query_selector('article, main, [class*="content"], [class*="talk"]')
        if article:
            html = article.inner_html()
            text = clean_text(html)
            if len(text) > 200:
                return text

        # Fallback: get all text from body, strip nav/footer
        body = page.query_selector('body')
        if body:
            # Remove navigation, footer, sidebar elements
            for selector in ['nav', 'footer', 'header', 'aside', '.nav', '.footer', '.sidebar']:
                for el in body.query_selector_all(selector):
                    el.inner_html('')
            text = clean_text(body.inner_html())
            if len(text) > 200:
                return text

    except Exception as e:
        print(f"    Error extracting text: {e}")

    return ''


def download_conference_talks():
    """Download talks from General Conference using Playwright."""
    ensure_dir()

    print("\n" + "=" * 60)
    print("  Downloading General Conference Talks (Playwright)")
    print("=" * 60)

    all_talks = []
    talk_files_saved = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
        )
        page = context.new_page()

        # Known recent conference slugs
        conferences = [
            '2024/04', '2024/10', '2023/04', '2023/10', '2022/04', '2022/10',
            '2021/04', '2021/10', '2020/04', '2020/10',
        ]

        for conf_slug in conferences:
            conf_url = f'{CONFERENCE_URL}/{conf_slug}'
            print(f"\n  Conference {conf_slug}...")

            try:
                page.goto(conf_url, wait_until='domcontentloaded', timeout=60000)
                page.wait_for_timeout(3000)

                # Collect all talk links on the page
                talk_links = []
                links_html = page.content()

                # Parse links from page content
                link_pattern = re.findall(
                    r'<a[^>]*href=["\']([^"\']*general-conference[^"\']*talk[^"\']*)["\'][^>]*>',
                    links_html
                )

                # Also try to find links via query_selector_all
                for link_elem in page.query_selector_all('a[href]'):
                    href = link_elem.get_attribute('href') or ''
                    if '/general-conference/' in href and '/talk/' in href:
                        if href.startswith('/'):
                            href = 'https://www.churchofjesuschrist.org' + href
                        talk_links.append(href)

                # Deduplicate
                talk_links = list(dict.fromkeys(talk_links))
                print(f"    Found {len(talk_links)} talks")

                for i, talk_url in enumerate(talk_links):
                    try:
                        page.goto(talk_url, wait_until='domcontentloaded', timeout=60000)

                        # Extract title
                        title = 'Unknown Talk'
                        h1 = page.query_selector('h1')
                        if h1:
                            title = h1.inner_text().strip()

                        # Extract speaker
                        speaker = 'Unknown'
                        speaker_elem = page.query_selector(
                            '[class*="speaker"], [class*="author"], [class*="byline"], '
                            'a[href*="/speakers/"], span[class*="name"]'
                        )
                        if speaker_elem:
                            speaker = speaker_elem.inner_text().strip()

                        # Extract date
                        date_str = ''
                        time_elem = page.query_selector('time')
                        if time_elem:
                            date_str = time_elem.get_attribute('datetime') or time_elem.inner_text().strip()

                        # Extract transcript text
                        text = extract_talk_text(page)

                        if text and len(text) > 200:
                            safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                            safe_title = re.sub(r'\s+', '-', safe_title)
                            output_path = BASE_DIR / f'{conf_slug.replace("/", "_")}_{safe_title}.txt'

                            content = f"Title: {title}\n"
                            content += f"Speaker: {speaker}\n"
                            content += f"Date: {date_str}\n"
                            content += f"URL: {talk_url}\n\n"
                            content += text

                            output_path.write_text(content, encoding='utf-8')
                            all_talks.append({
                                'title': title,
                                'speaker': speaker,
                                'date': date_str,
                                'url': talk_url,
                                'file': str(output_path),
                            })
                            talk_files_saved += 1
                            print(f"    [{i+1}/{len(talk_links)}] {title[:50]}... OK")
                        else:
                            print(f"    [{i+1}/{len(talk_links)}] {title[:40]}... SKIPPED (insufficient text)")

                        time.sleep(1)  # Be polite

                    except Exception as e:
                        print(f"    [{i+1}/{len(talk_links)}] ERROR: {e}")
                        continue

            except Exception as e:
                print(f"    Error fetching conference listing: {e}")
                continue

        browser.close()

    # Save index
    index_path = BASE_DIR / 'talks_index.json'
    index_path.write_text(json.dumps(all_talks, indent=2), encoding='utf-8')

    print(f"\n{'=' * 60}")
    print(f"  Total talks downloaded: {talk_files_saved}")
    print(f"  Files saved to: {BASE_DIR}")
    print("=" * 60)
    return talk_files_saved


if __name__ == '__main__':
    download_conference_talks()
