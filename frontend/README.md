# Verdigris — RAG console

Next.js frontend for the NestJS RAG backend in the parent folder. No auth, no
database, no persistence: conversation state lives in React and a page refresh
resets it.

## Running it

The backend must be running first, on port **3000**:

```bash
cd c:/projects/rag/rag-app
npm run start:dev
```

Then, in a second terminal:

```bash
cd c:/projects/rag/rag-app/frontend
npm install        # first time only
npm run dev        # http://localhost:3001
```

The frontend is pinned to port **3001** in `package.json`, so it never collides
with the backend on 3000. The backend calls `app.enableCors()`, so the browser
talks to it directly — there is no proxy or rewrite in the middle.

Point it somewhere else with an env var if needed:

```bash
# .env.local
NEXT_PUBLIC_RAG_API=http://localhost:3000
```

## Layout

| Path                       | What it is                                                 |
| -------------------------- | ---------------------------------------------------------- |
| `app/page.tsx`             | Chat view                                                  |
| `app/documents/page.tsx`   | Document list + delete                                     |
| `app/ingest/page.tsx`      | Paste text or upload a PDF                                 |
| `lib/api.ts`               | Typed backend client, including the hand-rolled SSE reader  |
| `lib/text.ts`              | RTL detection, date and similarity formatting              |
| `components/app-state.tsx` | Chat history + documents-changed signal, above the router   |

## Notes

- **Streaming.** `POST /rag/query-stream` is consumed with `fetch()` +
  `response.body.getReader()`, splitting on the `\n\n` SSE record separator.
  `EventSource` is not usable here: it is GET-only, and this endpoint needs a
  JSON body.
- **Sources.** The streaming endpoint sends tokens and a final `{done:true}`,
  never sources. The composer therefore has a **Stream tokens** toggle: on for
  live tokens with no sources, off for `POST /rag/query` with a collapsible
  Sources panel showing each chunk and its similarity to 2 decimals.
- **Errors.** A thrown `fetch()` surfaces as a distinct "Backend unreachable"
  alert, so a connection failure never looks like the backend's own
  "I don't have any relevant documents" answer. Validation `message` arrays from
  class-validator render as a list.
- **RTL.** Direction is detected per message from its own content, so an Arabic
  answer flips its layout and picks up IBM Plex Sans Arabic while the English UI
  chrome stays LTR.

## Backend files touched

The backend source is unmodified. Nesting this app inside `rag-app/` did require
adding `"frontend"` to the `exclude` array in the backend's `tsconfig.json` and
`tsconfig.build.json` — without it, `nest build` walks into these `.tsx` files
and fails with ~195 JSX errors.
