CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(384),
  metadata JSONB,
  document_id INT,
  created_at TIMESTAMP DEFAULT now()
);
