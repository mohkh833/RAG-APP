# RAG App

A self-hosted **Retrieval-Augmented Generation (RAG)** API built with [NestJS](https://nestjs.com/). It ingests text and PDFs, stores vector embeddings in PostgreSQL (via [pgvector](https://github.com/pgvector/pgvector)), retrieves the most relevant chunks for a question, and generates a grounded, cited answer with a local LLM served by [Ollama](https://ollama.com/). Ingested documents can be listed and deleted, and multi-turn conversations are supported via query rewriting.

Everything runs **locally** — no external API keys, no data leaving your machine:

- **Embeddings** — [`@xenova/transformers`](https://github.com/xenova/transformers.js) running `paraphrase-multilingual-MiniLM-L12-v2` (384-dim) in-process, so documents and questions can be in different languages.
- **Vector store** — PostgreSQL + `pgvector`.
- **Generation** — any Ollama model (default `llama3`), answering in the same language as the question.

---

## How it works

```
                 ┌─────────────┐
   POST /ingest  │  Chunking   │  split text into overlapping chunks
   ───────────►  └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │ Embeddings  │  multilingual MiniLM → 384-dim vector
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │  pgvector   │  INSERT chunk + embedding
                 └─────────────┘

                 ┌─────────────┐
   POST /query   │  Rewrite    │  only if `history` was sent:
   ───────────►  │   query     │  "Who built it?" → "Who built the Titanic?"
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │ Embed query │
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │  Retrieval  │  ORDER BY embedding <=> query  (cosine)
                 └──────┬──────┘  then drop hits below SIMILARITY_THRESHOLD
                        ▼
                 ┌─────────────┐
                 │ Generation  │  Ollama answers using ONLY retrieved context
                 └──────┬──────┘
                        ▼
                   { answer, sources[] }        (or SSE tokens via /query-stream)
```

Each concern is its own NestJS service under [`src/rag/`](src/rag/):

| Service | Responsibility |
|---|---|
| [`chunking`](src/rag/chunking/chunking.service.ts) | Split text into sentences, then into overlapping chunks of ~`CHUNK_SIZE` characters |
| [`embedding`](src/rag/embedding/embedding.service.ts) | Turn text into a 384-dim vector (lazy-loaded model) |
| [`ingestion`](src/rag/ingestion/ingestion.service.ts) | Chunk → embed → store a `documents` row + its `document_chunks`, transactionally |
| [`retrieval`](src/rag/retrieval/retrieval.service.ts) | Nearest-neighbour vector search, filtered by a minimum similarity |
| [`generation`](src/rag/generation/generation.service.ts) | Rewrite follow-ups, build a grounded prompt, call Ollama (buffered or streaming) |
| [`documents`](src/rag/documents/document.service.ts) | List and delete ingested documents |

### Two details worth knowing

**Documents are deduplicated.** Ingesting text whose SHA-256 hash matches an existing document is a no-op — the existing `documentId` is returned with `chunksStored: 0`. Within a single document, identical chunks are also collapsed before embedding, and reported as `chunksSkipped`.

**Chunks are embedded with their document title prefixed** (`Document: <title>\n<chunk>`), so an isolated chunk saying "the ship sank" is still retrievable by a question about the Titanic. The **original**, unprefixed chunk is what gets stored and cited, so answers stay clean.

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
| `TOP_K` | `5` | Number of chunks retrieved per query (overridable per request with `topK`) |
| `SIMILARITY_THRESHOLD` | `0.5` | Minimum cosine similarity a chunk must reach to be used as context |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3` | Ollama model used for generation **and** for follow-up query rewriting |

---

## API

### `POST /rag/ingest`

Ingest raw text. It is chunked, embedded, and stored as a new document.

```bash
curl -X POST http://localhost:3000/rag/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The Eiffel Tower is located in Paris, France. It was completed in 1889 and stands 330 meters tall.",
    "title": "Eiffel Tower"
  }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Text to ingest |
| `title` | string | no | Document title. Defaults to `"Untitled document"`, and is prefixed to each chunk at embedding time |
| `source` | string | no | Where the text came from (filename, URL, …) |
| `metadata` | object | no | Arbitrary JSON stored alongside each chunk |

The document id is assigned by the database — you don't supply it.

**Response**

```json
{ "documentId": 1, "chunksStored": 1, "chunksSkipped": 0 }
```

Re-posting identical `text` returns the same `documentId` with `chunksStored: 0` instead of storing it twice.

---

### `POST /rag/ingest-file`

Ingest a PDF (`multipart/form-data`). Text is extracted, then chunked and embedded. `title` is optional and falls back to the uploaded filename; `source` is always the filename.

```bash
curl -X POST http://localhost:3000/rag/ingest-file \
  -F "file=@document.pdf" \
  -F "title=Quarterly Report"
```

Returns the same shape as `/rag/ingest`.

---

### `GET /rag/documents`

List every ingested document, newest first, with its chunk count.

```json
[
  {
    "id": 1,
    "title": "Eiffel Tower",
    "source": null,
    "ingestedAt": "2026-07-31T21:04:11.000Z",
    "chunkCount": 1
  }
]
```

---

### `DELETE /rag/documents/:id`

Delete a document and — via `ON DELETE CASCADE` — all of its chunks. Returns `{ "deleted": true }`, or `404` if the id doesn't exist.

```bash
curl -X DELETE http://localhost:3000/rag/documents/1
```

---

### `POST /rag/query`

Ask a question. Relevant chunks are retrieved and passed to the LLM, which answers using **only** that context, cites its sources, and replies in the **same language as the question**.

```bash
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{ "question": "How tall is the Eiffel Tower?" }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `question` | string | yes | The question to answer |
| `topK` | number | no | Overrides the `TOP_K` env default for this request |
| `history` | array | no | Prior turns as `{ "role": "user" \| "assistant", "content": "..." }` |

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

If nothing scores at or above `SIMILARITY_THRESHOLD`, `answer` explains that no documents were found and `sources` is empty.

#### Follow-up questions

Pass the prior turns as `history` and a context-dependent follow-up is first **rewritten into a standalone question**, so retrieval embeds "Who built the Titanic?" rather than the pronoun-laden "Who built it?":

```bash
curl -X POST http://localhost:3000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Who built it?",
    "history": [
      { "role": "user", "content": "When did the Titanic sink?" },
      { "role": "assistant", "content": "It sank in 1912." }
    ]
  }'
```

The rewrite preserves the language of the follow-up, and costs **one extra Ollama call** per query that includes history. If it fails or returns nothing, the original question is used instead. The history is also shown to the generation prompt — but only to resolve references, never as a source of facts.

---

### `POST /rag/query-stream`

Same as `/rag/query` — including `topK` and `history` — but the answer is streamed token by token as **Server-Sent Events** instead of being buffered until complete. Sources are not returned on this endpoint.

```bash
curl -N -X POST http://localhost:3000/rag/query-stream \
  -H "Content-Type: application/json" \
  -d '{ "question": "How tall is the Eiffel Tower?" }'
```

**Response** (`text/event-stream`)

```
data: {"token":"330"}

data: {"token":" meters"}

data: {"token":" [1]."}

data: {"done":true}
```

If generation fails mid-stream, a final `data: {"error":"..."}` event is sent before the connection closes.

---

## Database schema

Defined in [`init.sql`](init.sql):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id           SERIAL PRIMARY KEY,
  title        TEXT,
  source       TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  ingested_at  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id           SERIAL PRIMARY KEY,
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding    vector(384),
  metadata     JSONB,
  document_id  INT REFERENCES documents(id) ON DELETE CASCADE,
  created_at   TIMESTAMP DEFAULT now()
);
```

`documents.content_hash` is the `UNIQUE` constraint that makes re-ingesting identical text a no-op; `document_chunks.content_hash` identifies duplicate chunks within a document.

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
- **@xenova/transformers** (`paraphrase-multilingual-MiniLM-L12-v2`) — local multilingual embeddings
- **Ollama** — local LLM generation
- **pdf-parse** — PDF text extraction
