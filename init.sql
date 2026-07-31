CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title TEXT,
  source TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  ingested_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding vector(384),
  metadata JSONB,
  document_id INT REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now()
);
