"""
Downloads General Conference talks from churchofjesuschrist.org using Requests and BS4.
Bypasses the Playwright URL structure issues and Akamai bot blocking.

Pass a list of years to limit the download, e.g.
download_conference_talks(years=[2018, 2019, 2020]).
"""
import os
import re
import json
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent / 'data' / 'conference'
CONFERENCE_URL = 'https://www.churchofjesuschrist.org/study/general-conference'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

def ensure_dir():
    BASE_DIR.mkdir(parents=True, exist_ok=True)

def extract_talk_text(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    main = soup.find('main') or soup.find('article') or soup.find('body')
    if not main: return ''
    
    for elem in main(['nav', 'footer', 'header', 'aside', 'script', 'style', 'figure']):
        elem.decompose()
        
    text = main.get_text(separator='\n', strip=True)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def generate_conferences(start_year=2000, end_year=None):
    """Generate conference slugs (year/month) from start_year to end_year.

    Past years include both April (04) and October (10) sessions. The current
    year only includes sessions that have already concluded.
    """
    if end_year is None:
        end_year = datetime.now().year
    now = datetime.now()

    conferences = []
    for year in range(start_year, end_year + 1):
        if year == now.year and year == end_year:
            if now.month >= 4:
                conferences.append(f'{year}/04')
            if now.month >= 10:
                conferences.append(f'{year}/10')
        else:
            conferences.append(f'{year}/04')
            conferences.append(f'{year}/10')
    return conferences


def resolve_conferences(years=None):
    """Return the list of conference slugs for the requested years."""
    if years:
        slugs = []
        for year in sorted(set(years)):
            slugs.extend(generate_conferences(year, year))
        return slugs
    return generate_conferences()


def download_conference_talks(years=None):
    ensure_dir()
    print("\n" + "=" * 60)
    print("  Downloading General Conference Talks (Requests/BS4 Pivot)")
    if years:
        print(f"  Years: {sorted(set(years))}")
    print("=" * 60)
    
    all_talks = []
    talk_files_saved = 0
    session = requests.Session()
    session.headers.update(HEADERS)

    conferences = resolve_conferences(years)

    for conf_slug in conferences:
        conf_url = f'{CONFERENCE_URL}/{conf_slug}?lang=eng'
        print(f"\n  Conference {conf_slug}...")
        try:
            resp = session.get(conf_url, timeout=30)
            if resp.status_code != 200: continue
            
            soup = BeautifulSoup(resp.text, 'html.parser')
            talk_links = []
            
            for a in soup.find_all('a', href=True):
                href = a['href']
                if f'/general-conference/{conf_slug}/' in href and len(href.split('/')) > 5:
                    if href.startswith('/'): href = 'https://www.churchofjesuschrist.org' + href
                    if '?lang=' not in href: href += '?lang=eng'
                    talk_links.append(href)
                    
            talk_links = list(dict.fromkeys(talk_links))
            print(f"    Found {len(talk_links)} talks")

            for i, talk_url in enumerate(talk_links):
                try:
                    t_resp = session.get(talk_url, timeout=30)
                    t_soup = BeautifulSoup(t_resp.text, 'html.parser')
                    
                    h1 = t_soup.find('h1')
                    title = h1.get_text(strip=True) if h1 else 'Unknown Talk'
                    
                    speaker = 'Unknown'
                    speaker_elem = t_soup.find('p', class_=re.compile(r'author', re.I)) or t_soup.find(id='author1')
                    if speaker_elem: speaker = speaker_elem.get_text(strip=True)

                    text = extract_talk_text(t_resp.text)
                    if len(text) > 200:
                        safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                        safe_title = re.sub(r'\s+', '-', safe_title)
                        output_path = BASE_DIR / f'{conf_slug.replace("/", "_")}_{safe_title}.txt'
                        content = f"Title: {title}\nSpeaker: {speaker}\nURL: {talk_url}\n\n{text}"
                        output_path.write_text(content, encoding='utf-8')
                        all_talks.append({'title': title, 'speaker': speaker, 'url': talk_url, 'file': str(output_path)})
                        talk_files_saved += 1
                        print(f"    [{i+1}/{len(talk_links)}] {title[:50]}... OK")
                    else:
                        print(f"    [{i+1}/{len(talk_links)}] {title[:40]}... SKIPPED")
                    time.sleep(0.5)
                except Exception as e:
                    print(f"    [{i+1}/{len(talk_links)}] ERROR: {e}")
                    
        except Exception as e:
            print(f"    Error fetching conference listing: {e}")

    index_path = BASE_DIR / 'talks_index.json'
    index_path.write_text(json.dumps(all_talks, indent=2), encoding='utf-8')
    print(f"\n{'=' * 60}")
    print(f"  Total talks downloaded: {talk_files_saved}")
    print(f"  Files saved to: {BASE_DIR}")
    print("=" * 60)
    return talk_files_saved

if __name__ == '__main__':
    download_conference_talks()
