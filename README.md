# RAG App

A self-hosted **Retrieval-Augmented Generation (RAG)** API built with [NestJS](https://nestjs.com/). It ingests text, stores vector embeddings in PostgreSQL (via [pgvector](https://github.com/pgvector/pgvector)), retrieves the most relevant chunks for a question, and generates a grounded, cited answer with a local LLM served by [Ollama](https://ollama.com/).

Everything runs **locally** — no external API keys, no data leaving your machine:

- **Embeddings** — [`@xenova/transformers`](https://github.com/xenova/transformers.js) running `all-MiniLM-L6-v2` (384-dim) in-process.
- **Vector store** — PostgreSQL + `pgvector`.
- **Generation** — any Ollama model (default `llama3`).

---

## How it works

```
                 ┌─────────────┐
   POST /ingest  │  Chunking   │  split text into overlapping chunks
   ───────────►  └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │ Embeddings  │  all-MiniLM-L6-v2 → 384-dim vector
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │  pgvector   │  INSERT chunk + embedding
                 └─────────────┘

                 ┌─────────────┐
   POST /query   │ Embed query │
   ───────────►  └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │  Retrieval  │  ORDER BY embedding <=> query  (cosine)
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │ Generation  │  Ollama answers using ONLY retrieved context
                 └──────┬──────┘
                        ▼
                   { answer, sources[] }
```

Each concern is its own NestJS service under [`src/rag/`](src/rag/):

| Service | Responsibility |
|---|---|
| [`chunking`](src/rag/chunking/chunking.service.ts) | Split text into fixed-size overlapping chunks |
| [`embedding`](src/rag/embedding/embedding.service.ts) | Turn text into a 384-dim vector (lazy-loaded model) |
| [`ingestion`](src/rag/ingestion/ingestion.service.ts) | Chunk → embed → store in `document_chunks` |
| [`retrieval`](src/rag/retrieval/retrieval.service.ts) | Nearest-neighbour vector search over stored chunks |
| [`generation`](src/rag/generation/generation.service.ts) | Build a grounded prompt and call Ollama |

---

## Prerequisites

- **Node.js** 18+ and **Yarn**
- **Docker** (for the PostgreSQL + pgvector database)
- **[Ollama](https://ollama.com/)** installed and running locally, with a model pulled:
  ```bash
  ollama pull llama3
  ```

---

## Quick start

```bash
# 1. Install dependencies
yarn install

# 2. Start PostgreSQL with the pgvector extension (schema is auto-created on first run)
docker compose up -d

# 3. Make sure Ollama is running and a model is available
ollama pull llama3

# 4. Start the API
yarn start:dev
```

The API listens on **http://localhost:3000**.

> **Note:** The database schema in [`init.sql`](init.sql) is applied automatically the **first** time the Postgres container initializes an empty data volume. If you started the container before this file was wired in, apply it once manually:
> ```bash
> docker exec -i rag-postgres psql -U postgres -d ragdb < init.sql
> ```

---

## Configuration

All settings are read from environment variables (see [`.env`](.env)), falling back to sensible defaults:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API port |
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PORT` | `5432` | Postgres port |
| `DB_USER` | `postgres` | Postgres user |
| `DB_PASSWORD` | `postgres` | Postgres password |
| `DB_NAME` | `ragdb` | Database name |
| `CHUNK_SIZE` | `500` | Characters per chunk |
| `CHUNK_OVERLAP` | `50` | Character overlap between chunks |
| `TOP_K` | `5` | Number of chunks retrieved per query |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3` | Ollama model used for generation |

---

## API

### `POST /rag/ingest`

Ingest raw text. It is chunked, embedded, and stored.

```bash
curl -X POST http://localhost:3000/rag/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The Eiffel Tower is located in Paris, France. It was completed in 1889 and stands 330 meters tall.",
    "documentId": 1
  }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Text to ingest |
| `documentId` | number | yes | Your identifier for the source document |
| `metadata` | object | no | Arbitrary JSON stored alongside each chunk |

**Response**

```json
{ "chunksStored": 1 }
```

---

### `POST /rag/ingest-file`

Ingest a PDF (`multipart/form-data`). Text is extracted, then chunked and embedded.

```bash
curl -X POST http://localhost:3000/rag/ingest-file \
  -F "file=@document.pdf" \
  -F "documentId=2"
```

---

### `POST /rag/query`

Ask a question. Relevant chunks are retrieved and passed to the LLM, which answers using **only** that context and cites its sources.

```bash
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{ "question": "How tall is the Eiffel Tower?" }'
```

**Response**

```json
{
  "answer": "330 meters [1].",
  "sources": [
    {
      "content": "The Eiffel Tower is located in Paris, France. It was completed in 1889 and stands 330 meters tall.",
      "similarity": 0.806
    }
  ]
}
```

If nothing relevant is stored, `answer` explains that no documents were found and `sources` is empty.

---

## Database schema

Defined in [`init.sql`](init.sql):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
  id          SERIAL PRIMARY KEY,
  content     TEXT NOT NULL,
  embedding   vector(384),
  metadata    JSONB,
  document_id INT,
  created_at  TIMESTAMP DEFAULT now()
);
```

TypeORM runs with `synchronize: false`, so the schema is **not** auto-managed by the app — `init.sql` is the source of truth.

---

## Development

```bash
yarn start          # start
yarn start:dev      # start in watch mode
yarn start:prod     # run the compiled build (node dist/main)
yarn build          # compile to dist/
yarn lint           # eslint --fix
yarn format         # prettier
```

## Tests

```bash
yarn test           # unit tests
yarn test:e2e       # end-to-end tests
yarn test:cov       # coverage
```

---

## Tech stack

- **NestJS 10** — application framework
- **TypeORM** + **pg** — database access
- **PostgreSQL** + **pgvector** (`ankane/pgvector` image) — vector storage & search
- **@xenova/transformers** (`all-MiniLM-L6-v2`) — local embeddings
- **Ollama** — local LLM generation
- **pdf-parse** — PDF text extraction
