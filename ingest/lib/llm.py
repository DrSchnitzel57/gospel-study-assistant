import os
import requests
from typing import List

# LLM endpoint (unused by ingest, but defined for completeness)
LLM_BASE_URL = os.environ.get('LLM_BASE_URL', os.environ.get('OPENAI_BASE_URL', 'http://localhost:8000/v1'))
LLM_API_KEY = os.environ.get('LLM_API_KEY', os.environ.get('OPENAI_API_KEY', 'default-key'))

# Embedding endpoint
EMBEDDING_BASE_URL = os.environ.get('EMBEDDING_BASE_URL', os.environ.get('OPENAI_BASE_URL', 'http://localhost:8000/v1'))
EMBEDDING_API_KEY = os.environ.get('EMBEDDING_API_KEY', os.environ.get('OPENAI_API_KEY', 'default-key'))
EMBEDDING_MODEL = os.environ.get('EMBEDDING_MODEL', 'nomic-embed-text')
EMBEDDING_DIMENSIONS = int(os.environ.get('EMBEDDING_DIMENSIONS', '768'))


def get_embedding(text: str) -> List[float]:
    """Get a single embedding (convenience wrapper around batch)."""
    return get_embeddings([text])[0]


def get_embeddings(texts: List[str], batch_size: int = 64) -> List[List[float]]:
    """
    Get embeddings for a list of texts, sending them in batches.
    Returns a list of embedding vectors, one per input text.
    """
    all_embeddings: List[List[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        start_idx = i

        for attempt in range(3):
            try:
                resp = requests.post(
                    f'{EMBEDDING_BASE_URL}/embeddings',
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {EMBEDDING_API_KEY}',
                    },
                    json={
                        'model': EMBEDDING_MODEL,
                        'input': batch,
                    },
                    timeout=120,
                )
                resp.raise_for_status()
                data = resp.json()

                batch_embeddings = [item['embedding'] for item in data['data']]

                if len(batch_embeddings) != len(batch):
                    raise ValueError(
                        f"Expected {len(batch)} embeddings, got {len(batch_embeddings)}"
                    )

                for idx, emb in enumerate(batch_embeddings):
                    if len(emb) != EMBEDDING_DIMENSIONS:
                        raise ValueError(
                            f"Embedding {idx} has {len(emb)} dimensions, expected {EMBEDDING_DIMENSIONS}. "
                            f"Check EMBEDDING_DIMENSIONS in .env matches your model."
                        )

                all_embeddings.extend(batch_embeddings)
                break

            except requests.RequestException as e:
                if attempt == 2:
                    raise RuntimeError(
                        f"Embedding batch {start_idx // batch_size} failed after 3 attempts: {e}"
                    ) from e
                import time
                time.sleep(2 ** attempt)

    return all_embeddings
