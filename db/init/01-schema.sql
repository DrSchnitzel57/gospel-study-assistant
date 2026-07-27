-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Sources table
CREATE TABLE IF NOT EXISTS sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    enabled_by_default BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    author VARCHAR(255),
    date DATE,
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('primary', 'secondary')),
    official_status VARCHAR(20) NOT NULL CHECK (official_status IN ('official', 'unofficial')),
    doctrinal_weight VARCHAR(20) NOT NULL CHECK (doctrinal_weight IN ('core', 'supporting', 'policy', 'esoteric')),
    content_category VARCHAR(30) NOT NULL CHECK (content_category IN ('scripture', 'conference', 'manual', 'devotional', 'history')),
    source_id INTEGER REFERENCES sources(id),
    raw_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (title)
);

-- Chunks table (text segments with embeddings)
-- embedding must have fixed dimensions for HNSW index to work
CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    embedding vector(4096),
    page_number INTEGER,
    verse_reference VARCHAR(255),
    overlap_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Full-text search index on chunk text
CREATE INDEX IF NOT EXISTS idx_chunks_text_fts ON chunks USING GIN(to_tsvector('english', text));

-- Vector similarity index (IVFFlat, supports >2000 dimensions)
-- HNSW has a 2000-dim limit, so IVFFlat is required for 4096-dim embeddings
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Source type index for filtering
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(content_category);
CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);
CREATE INDEX IF NOT EXISTS idx_documents_official ON documents(official_status);
CREATE INDEX IF NOT EXISTS idx_documents_doctrinal ON documents(doctrinal_weight);

-- Seed sources
INSERT INTO sources (name, slug, enabled_by_default, description) VALUES
    ('The Bible', 'bible', true, 'The Holy Bible: Old and New Testaments'),
    ('Book of Mormon', 'book-of-mormon', true, 'The Book of Mormon: Another Testament of Jesus Christ'),
    ('Doctrine and Covenants', 'doctrine-and-covenants', true, 'Doctrine and Covenants'),
    ('Pearl of Great Price', 'pearl-of-great-price', true, 'Pearl of Great Price'),
    ('General Conference Talks', 'general-conference', true, 'Talks from General Conferences of The Church of Jesus Christ of Latter-day Saints'),
    ('Come Follow Me', 'come-follow-me', true, 'Come, Follow Me scripture study manuals for individuals and families'),
    ('BYU Devotionals', 'byu-devotionals', true, 'Brigham Young University devotionals'),
    ('Institute Manuals', 'institute-manuals', true, 'Religious Education Curriculum Manuals (e.g., Foundations of the Restoration)'),
    ('Church History', 'church-history', false, 'Gospel Topics Essays, Church-approved history resources')
ON CONFLICT (slug) DO NOTHING;
