"""
Downloads BYU devotionals, Come Follow Me manuals, and Gospel Topics.
Uses Requests and BeautifulSoup to fetch Server-Side Rendered (SSR) HTML.
Bypasses the Playwright networkidle timeouts and Akamai JS challenges.
"""
import os
import re
import json
import time
import requests
from bs4 import BeautifulSoup
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent / 'data'
BASE_URL = 'https://www.churchofjesuschrist.org'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

KNOWN_TOPIC_SLUGS = [
    'baptism', 'children-of-god', 'christian-doctrine', 'church-discipline',
    'common-core-biblical-and-mormon-doctrines', 'd-and-c-6', 'death-and-foreordination',
    'doctrine-and-covenants', 'earth-and-its-inhabitants', 'faith', 'faith-jesus-christ',
    'family', 'family-proclamation', 'first-amendment', 'freedom-of-religion', 
    'gathering-of-israel', 'gospel-of-jesus-christ', 'holy-bible', 'jesus-christ',
    'joseph-smith', 'joseph-smith-first-vision', 'plan-of-salvation', 'priesthood', 
    'restoration-of-the-church', 'the-book-of-mormon', 'the-temple', 'word-of-wisdom'
]

def ensure_dirs():
    (BASE_DIR / 'manuals').mkdir(parents=True, exist_ok=True)
    (BASE_DIR / 'devotionals').mkdir(parents=True, exist_ok=True)
    (BASE_DIR / 'history').mkdir(parents=True, exist_ok=True)

def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    main = soup.find('main') or soup.find('article') or soup.find('body')
    if not main: return ''
    
    for tag in main(['nav', 'footer', 'header', 'aside', 'script', 'style', 'figure', 'button', 'img', 'svg']):
        tag.decompose()
        
    text = main.get_text(separator='\n', strip=True)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def download_gospel_topics() -> int:
    print("\n=== Downloading Gospel Topics ===")
    all_essays = []
    saved = 0
    session = requests.Session()
    session.headers.update(HEADERS)
    
    topic_links = [f'{BASE_URL}/study/gospel-topics/{slug}?lang=eng' for slug in KNOWN_TOPIC_SLUGS]
    print(f"  Downloading {len(topic_links)} known topics...")

    for i, topic_url in enumerate(topic_links):
        try:
            resp = session.get(topic_url, timeout=30)
            if resp.status_code != 200: continue
            
            soup = BeautifulSoup(resp.text, 'html.parser')
            title_elem = soup.find('h1')
            title = title_elem.get_text(strip=True) if title_elem else f"Topic {i+1}"
            
            text = extract_text(resp.text)
            if len(text) > 200:
                safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                safe_title = re.sub(r'\s+', '-', safe_title)
                output_path = BASE_DIR / 'history' / f'Topic_{safe_title}.txt'
                
                content = f"Title: {title}\nURL: {topic_url}\n\n{text}"
                output_path.write_text(content, encoding='utf-8')
                
                all_essays.append({'title': title, 'url': topic_url, 'file': str(output_path)})
                saved += 1
                print(f"    [{i+1}/{len(topic_links)}] {title[:40]}... OK")
            time.sleep(0.5)
        except Exception as e:
            print(f"    [{i+1}/{len(topic_links)}] ERROR: {e}")

    index_path = BASE_DIR / 'history' / 'topics_index.json'
    index_path.write_text(json.dumps(all_essays, indent=2), encoding='utf-8')
    return saved

def download_cfm_manuals() -> int:
    print("\n=== Downloading Come, Follow Me Manuals ===")
    all_lessons = []
    saved = 0
    session = requests.Session()
    session.headers.update(HEADERS)
    
    years = ['2024', '2025']
    seasons = ['01', '04', '07', '10']
    
    for year in years:
        for season in seasons:
            period = f'{year}/{season}'
            print(f"\n  Period: {period}")
            
            listing_url = f'{BASE_URL}/study/come-follow-me/home-and-church/{year}/{season}?lang=eng'
            
            try:
                resp = session.get(listing_url, timeout=30)
                if resp.status_code != 200:
                    listing_url = f'{BASE_URL}/study/come-follow-me/individual-family/{year}/{season}?lang=eng'
                    resp = session.get(listing_url, timeout=30)
                
                soup = BeautifulSoup(resp.text, 'html.parser')
                
                lesson_links = []
                for a in soup.find_all('a', href=True):
                    href = a['href']
                    if '/come-follow-me/' in href and period in href and len(href.split('/')) > 6:
                        if href.startswith('/'): href = BASE_URL + href
                        if '?lang=' not in href: href += '?lang=eng'
                        lesson_links.append(href)
                        
                lesson_links = list(dict.fromkeys(lesson_links))
                print(f"    Found {len(lesson_links)} lessons")
                
                for i, lesson_url in enumerate(lesson_links):
                    try:
                        l_resp = session.get(lesson_url, timeout=30)
                        l_soup = BeautifulSoup(l_resp.text, 'html.parser')
                        title_elem = l_soup.find('h1')
                        title = title_elem.get_text(strip=True) if title_elem else f"Lesson {i+1}"
                        
                        text = extract_text(l_resp.text)
                        if len(text) > 200:
                            safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                            safe_title = re.sub(r'\s+', '-', safe_title)
                            output_path = BASE_DIR / 'manuals' / f'CFM_{period.replace("/", "_")}_{safe_title}.txt'
                            content = f"Title: {title}\nPeriod: {period}\nURL: {lesson_url}\n\n{text}"
                            output_path.write_text(content, encoding='utf-8')
                            all_lessons.append({'title': title, 'period': period, 'url': lesson_url, 'file': str(output_path)})
                            saved += 1
                            print(f"      [{i+1}/{len(lesson_links)}] {title[:40]}... OK")
                        time.sleep(0.5)
                    except Exception as e:
                        print(f"      [{i+1}/{len(lesson_links)}] ERROR: {e}")
            except Exception as e:
                print(f"    Error fetching listing: {e}")
                
    index_path = BASE_DIR / 'manuals' / 'cfm_index.json'
    index_path.write_text(json.dumps(all_lessons, indent=2), encoding='utf-8')
    return saved

def download_byu_speeches() -> int:
    print("\n=== Downloading BYU Speeches ===")
    all_devotionals = []
    saved = 0
    session = requests.Session()
    session.headers.update(HEADERS)
    byu_base = 'https://speeches.byu.edu'
    
    try:
        resp = session.get(f'{byu_base}/speeches', timeout=30)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        speech_links = []
        for a in soup.find_all('a', href=True):
            href = a['href']
            if '/talks/' in href and len(href.split('/')) > 4:
                if not href.startswith('http'): href = byu_base + href
                speech_links.append(href)
                
        speech_links = list(dict.fromkeys(speech_links))[:25]
        print(f"  Found {len(speech_links)} speeches")
        
        for i, speech_url in enumerate(speech_links):
            try:
                s_resp = session.get(speech_url, timeout=30)
                s_soup = BeautifulSoup(s_resp.text, 'html.parser')
                
                title_elem = s_soup.find('h1')
                title = title_elem.get_text(strip=True) if title_elem else "BYU Speech"
                
                speaker = "Unknown"
                speaker_elem = s_soup.find(class_=re.compile(r'speaker|author|byline', re.I))
                if speaker_elem: speaker = speaker_elem.get_text(strip=True)
                
                text = extract_text(s_resp.text)
                if len(text) > 200:
                    safe_title = re.sub(r'[^\w\s-]', '', title)[:80]
                    safe_title = re.sub(r'\s+', '-', safe_title)
                    output_path = BASE_DIR / 'devotionals' / f'BYU_{safe_title}.txt'
                    content = f"Title: {title}\nSpeaker: {speaker}\nURL: {speech_url}\n\n{text}"
                    output_path.write_text(content, encoding='utf-8')
                    all_devotionals.append({'title': title, 'speaker': speaker, 'url': speech_url, 'file': str(output_path)})
                    saved += 1
                    print(f"    [{i+1}/{len(speech_links)}] {title[:40]}... OK")
                time.sleep(0.5)
            except Exception as e:
                print(f"    [{i+1}/{len(speech_links)}] ERROR: {e}")
                
    except Exception as e:
        print(f"  Error fetching BYU speeches: {e}")
        
    index_path = BASE_DIR / 'devotionals' / 'byu_index.json'
    index_path.write_text(json.dumps(all_devotionals, indent=2), encoding='utf-8')
    return saved

def download_all():
    ensure_dirs()
    print("=" * 60)
    print("  Gospel Study Assistant - Supplementary Downloader (Requests/BS4)")
    print("=" * 60)
    cfm_count = download_cfm_manuals()
    byu_count = download_byu_speeches()
    topics_count = download_gospel_topics()
    print(f"\n{'=' * 60}")
    print(f"  CFM Manuals:     {cfm_count}")
    print(f"  BYU Speeches:    {byu_count}")
    print(f"  Gospel Topics:   {topics_count}")
    print("=" * 60)

if __name__ == '__main__':
    download_all()
