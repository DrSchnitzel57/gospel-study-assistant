"""
Main ingestion runner. Supports both scheduled (cron) and manual execution.

Usage:
  python -m scripts.run_ingest          # Run all ingesters
  python -m scripts.run_ingest scripture # Run scripture ingester only
  python -m scripts.run_ingest supplementary # Run conference/manuals/devotionals
  python -m scripts.run_ingest download_bible # Download Bible text files
  python -m scripts.run_ingest download_conference # Download conference talks (Playwright)
  python -m scripts.run_ingest download_conference 2018-2025 # Specific year range
  python -m scripts.run_ingest download_conference 2015 2018 2020 # Specific years
  python -m scripts.run_ingest download_conference all # Everything
  python -m scripts.run_ingest download_cfm # Download CFM manuals (Open Scripture API)
  python -m scripts.run_ingest download_byu # Download BYU devotionals (WordPress API)
  python -m scripts.run_ingest download_all # Download everything

Conference years accept: a range "2018-2025", a comma list "2015,2018,2020",
individual years, or "all". With no argument and a TTY, you will be prompted.
Note: docker compose run needs -it for the prompt (e.g.
docker compose run -it --rm ingest python -m scripts.run_ingest download_conference).
"""

import sys
import os
import time
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


def parse_years_arg(args):
    """Parse conference year arguments.

    Accepts ranges ("2018-2025"), comma lists ("2015,2018,2020"), individual
    years, or "all"/empty (returns None = every year).
    """
    if not args:
        return None

    years = []
    for arg in args:
        arg = arg.strip()
        if not arg or arg.lower() in ('all', '*', 'full'):
            return None
        try:
            if '-' in arg:
                parts = arg.split('-')
                if len(parts) != 2:
                    raise ValueError(f"expected YEAR-YEAR, got '{arg}'")
                start, end = int(parts[0]), int(parts[1])
                if start > end:
                    raise ValueError(f"range start ({start}) is after end ({end})")
                years.extend(range(start, end + 1))
            elif ',' in arg:
                for part in arg.split(','):
                    part = part.strip()
                    if part:
                        years.append(int(part))
            else:
                years.append(int(arg))
        except ValueError as e:
            raise ValueError(f"invalid year '{arg}'") from e

    years = sorted(set(years))
    for year in years:
        if not (1900 <= year <= 2050):
            raise ValueError(f"year {year} out of range (1900-2050)")
    return years


def prompt_for_conference_years():
    """Interactively ask which conference years to download. None = all."""
    while True:
        answer = input(
            "Which conference years do you want to download? "
            "(e.g. 2018-2025, comma list 2015,2018,2020, or 'all' [default]) "
        ).strip()
        if not answer or answer.lower() == 'all':
            return None
        try:
            return parse_years_arg([answer])
        except ValueError as e:
            logger.warning(f"  Invalid input ({e}). Try again.")


def download_conference_safe(years=None):
    try:
        from scripts.download_conference_playwright import download_conference_talks
        logger.info("Attempting conference download via Playwright...")
        download_conference_talks(years)
    except Exception as e:
        logger.warning(f"Playwright conference download failed ({e}), falling back to Requests/BS4 downloader...")
        from scripts.download_conference import download_conference_talks
        download_conference_talks(years)


def download_cfm_safe():
    try:
        from scripts.download_cfm import download_cfm_manuals
        logger.info("Downloading Come, Follow Me manuals via Open Scripture API...")
        download_cfm_manuals()
    except Exception as e:
        logger.warning(f"API CFM download failed ({e}), falling back to scraper...")
        from scripts.download_supplementary import download_cfm_manuals
        download_cfm_manuals()


def download_byu_safe():
    try:
        from scripts.download_byu_speeches import download_byu_speeches
        logger.info("Downloading BYU Speeches via WordPress REST API...")
        download_byu_speeches()
    except Exception as e:
        logger.warning(f"API BYU Speeches download failed ({e}), falling back to scraper...")
        from scripts.download_supplementary import download_byu_speeches
        download_byu_speeches()


def download_supplementary_safe():
    from scripts.download_supplementary import download_gospel_topics
    download_cfm_safe()
    download_byu_safe()
    download_gospel_topics()


def run_ingestion(target: str = 'all'):
    """Run ingestion pipelines."""
    start = time.time()

    # Download commands
    if target == 'download_bible':
        from scripts.download_scriptures import download_all_bible
        download_all_bible()
        return

    if target == 'download_supplementary':
        download_supplementary_safe()
        return

    if target == 'download_conference':
        years = parse_years_arg(sys.argv[2:])
        if years is None and not sys.argv[2:] and sys.stdin.isatty():
            years = prompt_for_conference_years()
        if years is None:
            logger.info("No year filter given — downloading all conferences.")
        download_conference_safe(years)
        return

    if target == 'download_cfm':
        download_cfm_safe()
        return

    if target == 'download_byu':
        download_byu_safe()
        return

    if target == 'download_all':
        from scripts.download_scriptures import download_all_bible
        download_all_bible()
        download_conference_safe()
        download_supplementary_safe()
        return

    # Ingestion commands
    if target in ('all', 'scripture'):
        try:
            from scripts.ingest_scriptures import run_scripture_ingestion
            logger.info("Starting scripture ingestion...")
            run_scripture_ingestion()
            logger.info("Scripture ingestion complete.")
        except ImportError as e:
            logger.error(f"Scripture ingestion module not found: {e}")
        except Exception as e:
            logger.error(f"Scripture ingestion failed: {e}")

    if target in ('all', 'supplementary'):
        try:
            from scripts.ingest_supplementary import run_supplementary_ingestion
            logger.info("Starting supplementary ingestion...")
            run_supplementary_ingestion()
            logger.info("Supplementary ingestion complete.")
        except ImportError as e:
            logger.error(f"Supplementary ingestion module not found: {e}")
        except Exception as e:
            logger.error(f"Supplementary ingestion failed: {e}")

    if target == 'conference':
        try:
            from scripts.ingest_supplementary import ingest_conference_talks
            logger.info("Starting conference ingestion...")
            ingest_conference_talks()
            logger.info("Conference ingestion complete.")
        except ImportError as e:
            logger.error(f"Conference ingestion module not found: {e}")
        except Exception as e:
            logger.error(f"Conference ingestion failed: {e}")

    elapsed = time.time() - start
    logger.info(f"All ingestion complete in {elapsed:.1f}s")


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    run_ingestion(target)
