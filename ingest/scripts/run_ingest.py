"""
Main ingestion runner. Supports both scheduled (cron) and manual execution.

Usage:
  python -m scripts.run_ingest          # Run all ingesters
  python -m scripts.run_ingest scripture # Run scripture ingester only
  python -m scripts.run_ingest supplementary # Run conference/manuals/devotionals
  python -m scripts.run_ingest download_bible # Download Bible text files
  python -m scripts.run_ingest download_supplementary # Download supplementary text files
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


def run_ingestion(target: str = 'all'):
    """Run ingestion pipelines."""
    start = time.time()

    # Download commands
    if target == 'download_bible':
        from scripts.download_scriptures import download_all_bible
        download_all_bible()
        return

    if target == 'download_supplementary':
        from scripts.download_supplementary import download_all
        download_all()
        return

    if target == 'download_all':
        from scripts.download_scriptures import download_all_bible
        from scripts.download_supplementary import download_all
        download_all_bible()
        download_all()
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

    elapsed = time.time() - start
    logger.info(f"All ingestion complete in {elapsed:.1f}s")


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    run_ingestion(target)
